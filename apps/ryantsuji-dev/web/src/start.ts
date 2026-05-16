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
 * - `GITHUB_*` / `X_OAUTH2_*` / `GOOGLE_*` / `FACEBOOK_*`:
 *   OAuth credentials (secret)
 *
 * @graph-connects none
 */
export interface Env {
  ASSETS: Fetcher;
  DATABASE_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  X_OAUTH2_CLIENT_ID: string;
  X_OAUTH2_CLIENT_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  FACEBOOK_CLIENT_ID: string;
  FACEBOOK_CLIENT_SECRET: string;
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
