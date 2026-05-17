/**
 * TanStack Start のグローバル設定 + Register module augmentation。
 *
 * `createStart()` は全 route の defaultSsr / serializationAdapters / serverFns 設定の
 * SSoT。本 app では明示的な global option を持たないが、**`Register.server.requestContext`
 * の型を宣言**する場として必須 (これが createServerFn / middleware の context.env を
 * 型付きで読めるようにする鍵)。
 *
 * runtime での env injection は `src/server.ts` (Worker entry) で `handler.fetch(req, {
 * context: { env, ctx } })` 経由。dev (vite) では `@cloudflare/vite-plugin` が同じ
 * shape の env (wrangler.jsonc / `.dev.vars` から) を inject する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business TanStack Start の global config + Cloudflare Workers env binding 型宣言。Register.server.requestContext を `{ env: Env; ctx: ExecutionContext }` に固定し、各 server fn / middleware から型付きで env を読めるようにする
 * @graph-connects tanstack-start [provides] startInstance (global config) と Register augmentation で requestContext 型を公開
 */

import { createStart } from "@tanstack/react-start";

/**
 * Cloudflare Workers の env binding (secrets + vars + assets fetcher)。本 app の
 * `wrangler.jsonc` / `wrangler secret put` で設定する変数と 1:1 対応。
 *
 * - `ASSETS`: `wrangler.jsonc:assets.binding` で wire される static asset fetcher
 * - `DATABASE_URL`: Neon pooled connection (secret)
 * - `BETTER_AUTH_SECRET`: 32+ 文字ランダム (secret)
 * - `BETTER_AUTH_URL`: 公開 URL (vars でも可、現状 secret 扱い)
 * - `GITHUB_*` / `X_OAUTH2_*` / `GOOGLE_*`: OAuth credentials (secret)
 * - `OTLP_ENDPOINT` / `OTLP_AUTH_HEADER`: Grafana Cloud OTLP write target (secret)。
 *   設定無しなら server.ts 側で計装が no-op になる (= 未配線 stage でも runtime に
 *   実害を出さない) — 値 SSoT は GCP Secret Manager `grafana-otlp-write-token`
 * - `GCP_SA_JSON`: graph-app SA の JSON key (Worker secret)。`/api/track` から BQ
 *   tabledata.insertAll を呼ぶための credentials — 値 SSoT は GCP Secret Manager
 *   `gcp-sa-graph-app-key`。`wrangler secret put GCP_SA_JSON < sa.json` で投入
 * - `BQ_PROJECT_ID` / `BQ_DATASET` / `BQ_TABLE`: BQ 書き込み先 (wrangler vars)
 *
 * @graph-connects none
 */
export interface Env {
  ASSETS: Fetcher;
  /**
   * R2 bucket binding (`ryantsuji-dev-images`)。post 添付画像の配信元。`src/server.ts`
   * の `/images/*` route handler が `env.IMAGES.get(key)` で fetch する。dev 時の
   * vite middleware (`vite-plugins/local-images.ts`) は file system 直 read で代替する
   * ため、Env 型としては存在しても dev runtime には bind されない (server.ts 側で
   * `/images/*` 経路は dev では vite が intercept する前提)。
   */
  IMAGES: R2Bucket;
  DATABASE_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  X_OAUTH2_CLIENT_ID: string;
  X_OAUTH2_CLIENT_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  OTLP_ENDPOINT?: string;
  OTLP_AUTH_HEADER?: string;
  GCP_SA_JSON?: string;
  BQ_PROJECT_ID?: string;
  BQ_DATASET?: string;
  BQ_TABLE?: string;
}

/**
 * Register module augmentation。`createServerFn().handler({ context })` /
 * `createMiddleware().server({ context })` で `context.env` / `context.ctx` を
 * 型付きで読めるようにする。runtime の wiring は `src/server.ts` 側。
 *
 * @graph-connects tanstack-start [provides] requestContext の型を Register に注入
 */
declare module "@tanstack/router-core" {
  interface Register {
    server: {
      requestContext: {
        env: Env;
        ctx: ExecutionContext;
      };
    };
  }
}

/**
 * TanStack Start の startInstance singleton。現状追加 option はないが、SKILL.md の
 * 慣習 (`src/start.ts` に export) に従って配置する。後で defaultSsr / serializationAdapters
 * を入れる時の hook ポイント。
 *
 * @graph-connects tanstack-start [provides] start global config singleton
 */
export const startInstance = createStart(() => ({}));
