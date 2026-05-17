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
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business CF Workers fetch handler。Workers の (req, env, ctx) を TanStack Start handler の requestContext に forward することで、各 server fn / middleware から context.env で型付きの env binding を読めるようにする。本 app の env-driven config (DB / auth) の正しい注入経路
 * @graph-connects tanstack-start [calls] createStartHandler(defaultStreamHandler) で SSR handler を構築し、forward fetch で context を流す
 */

import { Buffer } from "node:buffer";

import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";

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
 * Workers の default fetch handler。`{ env, ctx }` を context に詰めて TanStack Start に
 * forward する。`start.ts` の Register augmentation でこの shape が型保証される。
 *
 * @graph-connects tanstack-start [calls] handler.fetch(req, { context: { env, ctx } })
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return await handler(request, { context: { env, ctx } });
  },
};
