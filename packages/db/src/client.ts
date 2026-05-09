/**
 * Neon HTTP driver + Drizzle client wrapper。
 *
 * CF Workers / edge runtime から fetch ベースで Postgres を叩ける。`@neondatabase/serverless`
 * の HTTP variant を使うことで TCP socket 不要 (Workers の制約に合致)。
 *
 * 使い方:
 * ```ts
 * import { createDb } from "@self/db/client";
 * const db = createDb(env.DATABASE_URL);
 * const rows = await db.select().from(posts);
 * ```
 *
 * `env.DATABASE_URL` は **pooled** connection string を渡す:
 * - 開発: `.envrc.local` の `DATABASE_URL` (direnv 経由で `process.env` に)
 * - production: `wrangler secret put DATABASE_URL` で CF Workers binding に
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business CF Workers / edge runtime 対応の Drizzle client factory。Neon HTTP driver で TCP 不要、`createDb(url)` で per-request に instance を作る形 (state を持たないので Workers の constraint と整合)
 * @graph-connects drizzle [embeds] drizzle-orm/neon-http で Drizzle ORM を Neon HTTP に bind
 * @graph-connects neon [calls] @neondatabase/serverless の neon() で HTTP client を生成
 */

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema/index.js";

/**
 * Neon HTTP + Drizzle client を作る。1 request 1 instance を想定 (CF Workers の
 * isolate モデルに合わせて lazy + ephemeral)。
 *
 * @graph-connects neon [calls] HTTP fetch ベースの Postgres client を確立
 */
export function createDb(databaseUrl: string) {
  const sql = neon(databaseUrl);
  return drizzle(sql, { schema });
}

/** `createDb` の戻り型 (consumer 側で型を再 export しない用)。 */
/** @graph-connects none */
export type Db = ReturnType<typeof createDb>;
