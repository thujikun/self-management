/**
 * `process.env` から `DATABASE_URL` を取り出して Drizzle (Neon HTTP) client を作る薄い helper。
 *
 * createServerFn handler 内 / Better Auth handler 内のどちらからも同 shape で使える
 * ように、env から URL を読む経路を 1 か所に集約する。CF Workers binding 化する時は
 * ここを `(env) => createDb(env.DATABASE_URL)` 形に拡張する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business `createDb(DATABASE_URL)` を per-request に立ち上げる server-side helper。env の読み出しを 1 か所に集約し、createServerFn / api/auth route の両方から同 shape で db client を取れるようにする
 * @graph-connects content [embeds] @self/db の createDb で Drizzle/Neon HTTP client を生成
 */

import { createDb, type Db } from "@self/db";

/**
 * env から DATABASE_URL を取り出す。test から差し替え可能なように引数で受ける。
 * 未設定なら明示的に throw して silent な誤実行を防ぐ。
 *
 * @graph-connects none
 */
export function readDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL;
  if (!url || url.length === 0) {
    throw new Error("DATABASE_URL is not set (.envrc.local / wrangler secret を確認)");
  }
  return url;
}

/**
 * `process.env.DATABASE_URL` から Drizzle client を per-request に作る。
 * createServerFn handler の中で呼び、戻り値は使い捨て。
 *
 * @graph-connects content [calls] createDb(url) で Neon HTTP + Drizzle client を生成
 */
export function createDbFromProcess(env: NodeJS.ProcessEnv = process.env): Db {
  return createDb(readDatabaseUrl(env));
}
