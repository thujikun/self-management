/**
 * Cloudflare Workers entry point。`tanstackStart({ server: { entry: "./src/server.ts" } })`
 * 経由で wire され、`@tanstack/react-start/server-entry` の代わりに使われる。
 *
 * 役割は **`fetch(req, env, ctx)` で受け取った Workers binding を TanStack Start の
 * `RequestOptions.context` に forward** するだけ。これにより全 server fn / middleware
 * から `context.env.BETTER_AUTH_SECRET` 等を **process.env を介さずに型付きで**読める。
 *
 * default-entry (`@tanstack/react-start/server-entry`) は context.env を渡さない単純な
 * `(req, env, ctx) => handler.fetch(req, env, ctx)` 形なので、本 app は env binding が
 * 必須 (DATABASE_URL / OAuth credentials) のため override する。
 *
 * **OTel 計装**: handler を `@microlabs/otel-cf-workers` の `instrument` で wrap し、
 * 全 fetch invocation を span として OTLP 経由で Grafana Cloud Tempo に送る。endpoint
 * は `env.OTLP_ENDPOINT` / 認証は `env.OTLP_AUTH_HEADER` (`grafana-otlp-write-token`
 * 由来)。値が未投入の environment では exporter 経路が空に解決されるだけで handler
 * の応答は同一 (= 計装失敗が user 体験に伝播しない fail-open 設計)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business CF Workers fetch handler。Workers の (req, env, ctx) を TanStack Start handler の requestContext に forward することで、各 server fn / middleware から context.env で型付きの env binding を読めるようにする。本 app の env-driven config (DB / auth) の正しい注入経路。fetch 全 invocation を OTel span として Grafana Cloud に export
 * @graph-connects tanstack-start [calls] createStartHandler(defaultStreamHandler) で SSR handler を構築し、forward fetch で context を流す
 * @graph-connects grafana-cloud [writes_to] OTLP 経由で fetch span を Tempo に送出 (env.OTLP_ENDPOINT)
 */

import { Buffer } from "node:buffer";

import { instrument, type ResolveConfigFn } from "@microlabs/otel-cf-workers";
import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";

import { serveImage } from "./server-images.js";
import type { Env } from "./start.js";

// CF Workers の nodejs_compat + compatibility_date >= 2024-09-23 は
// `globalThis.Buffer` を自動 expose する建前だが、bundle 経路によっては bare
// `Buffer` 参照が `ReferenceError: Buffer is not defined` で落ちる事象が観測される
// ため、Worker entry で明示的に再代入して global 到達性を保証する。現状の依存は
// better-auth の base64 encode 経路 / TanStack の serialization 経路。markdown
// render 系 (gray-matter) は vite plugin (`virtual:rendered-posts`) で build 時に
// 隔離済で runtime bundle には含まれないため、ここでの Buffer 参照とは無関係。
if (typeof globalThis.Buffer === "undefined") {
  (globalThis as { Buffer: typeof Buffer }).Buffer = Buffer;
}

/**
 * TanStack Start の SSR handler。`defaultStreamHandler` で route 解決 + RSC stream を
 * Response として返す。本値は module load 時に 1 度だけ構築 (Workers isolate 寿命中 reuse)。
 *
 * @graph-connects tanstack-start [provides] createStartHandler で fetch handler を構築
 */
const handler = createStartHandler(defaultStreamHandler);

/**
 * Workers の base fetch handler。`{ env, ctx }` を context に詰めて TanStack Start に
 * forward する。`start.ts` の Register augmentation でこの shape が型保証される。
 *
 * @graph-connects tanstack-start [calls] handler.fetch(req, { context: { env, ctx } })
 */
const baseHandler: ExportedHandler<Env> = {
  async fetch(request, env, ctx): Promise<Response> {
    // `/images/*` route は TanStack Start に届く前に R2 binding (`env.IMAGES`) から
    // 直接 serve する。markdown 添付画像の配信を Worker route で完結させ、SSR /
    // hydration / RSC stream の bundle に画像 file が混ざらないようにする (assets
    // bundle 経由だと per-deploy upload 上限 / build artifact size に影響する)。
    const url = new URL(request.url);
    if (url.pathname.startsWith("/images/")) {
      // R2Bucket は CF Workers runtime の abstract class 由来で nominal 型なので、
      // serveImage が要求する structural な subset interface に明示 cast する。
      return await serveImage(env.IMAGES as unknown as Parameters<typeof serveImage>[0], request);
    }
    return await handler(request, { context: { env, ctx } });
  },
};

/**
 * OTel exporter 設定を env から組み立てる resolver。`instrument()` は per-request で
 * 本関数を呼んで exporter を組む。`OTLP_ENDPOINT` が未投入の場合は空 URL で resolve し、
 * exporter の POST が静かに失敗するだけで handler 応答には影響しない (fail-open)。
 *
 * `service.version` は wrangler.jsonc から bundle 時に拾えないため、package.json と
 * 手動同期する固定値で出す (release tag と一致させたい時は CI から `wrangler deploy
 * --var SERVICE_VERSION=...` で上書きする想定だが、本 PR では未対応)。
 *
 * @graph-connects grafana-cloud [calls] env.OTLP_ENDPOINT に Authorization header 付きで OTLP 送出
 */
const resolveTelemetryConfig: ResolveConfigFn = (env: Env) => {
  const headers: Record<string, string> = {};
  if (env.OTLP_AUTH_HEADER) headers.Authorization = env.OTLP_AUTH_HEADER;
  return {
    exporter: {
      url: env.OTLP_ENDPOINT ?? "",
      headers,
    },
    service: {
      name: "ryantsuji-dev-web",
      version: "0.1.0",
    },
  };
};

/**
 * 計装済 default export。`instrument()` は wrap した object を返すので、CF Workers
 * runtime が見る default export は OTel 経路 (incoming fetch + outgoing fetch / DO /
 * caches.* 等の自動 span 化) を通った後 `baseHandler.fetch` に到達する。
 *
 * @graph-connects grafana-cloud [embeds] @microlabs/otel-cf-workers の instrument wrapper
 */
export default instrument(baseHandler, resolveTelemetryConfig);
