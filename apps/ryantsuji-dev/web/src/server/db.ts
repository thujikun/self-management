/**
 * env binding から Drizzle (Neon HTTP) client を作る薄い helper。
 *
 * **CF Workers の `context.env`** (= `Register['server']['requestContext'].env`) を受け取り、
 * 1 request 1 instance で Db client を返す。`@self/db` の `createDb` を per-request に
 * 立ち上げる pattern (Neon HTTP は stateless なので isolate-scoped cache は不要)。
 *
 * `process.env` 経路は廃止 (CF Workers では module scope で undefined)。dev では
 * `@cloudflare/vite-plugin` が `.dev.vars` から同 shape の env を inject する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business CF Workers binding から Drizzle/Neon HTTP client を作る per-request helper。env の DATABASE_URL を 1 か所で取り出し、各 server fn / route handler から型付きで呼べるようにする
 * @graph-connects content [embeds] @self/db の createDb で Drizzle/Neon HTTP client を生成
 */

import { createDb, type Db } from "@self/db";

/**
 * `DATABASE_URL` を持つ env subset (`start.ts:Env` を直接 import せず loose に保つ)。
 *
 * @graph-connects none
 */
export interface DatabaseUrlEnv {
  DATABASE_URL: string;
}

/**
 * env から DATABASE_URL を取り出す。未設定 / 空文字なら明示的に throw して silent な
 * 誤実行 (Neon が anonymous local fallback に走る等) を防ぐ。
 *
 * @graph-connects none
 */
export function readDatabaseUrl(env: DatabaseUrlEnv): string {
  if (!env.DATABASE_URL || env.DATABASE_URL.length === 0) {
    throw new Error(
      "DATABASE_URL is not set (wrangler secret put DATABASE_URL / .dev.vars を確認)",
    );
  }
  return env.DATABASE_URL;
}

/**
 * env から Drizzle client を per-request に作る。createServerFn handler / route handler の
 * 中で `context.env` を渡して呼び、戻り値は使い捨て。
 *
 * @graph-connects content [calls] createDb(url) で Neon HTTP + Drizzle client を生成
 */
export function createDbFromEnv(env: DatabaseUrlEnv): Db {
  return createDb(readDatabaseUrl(env));
}
