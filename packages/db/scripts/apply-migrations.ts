/**
 * `migrations/*.sql` を Neon Postgres に **incremental** に適用する。
 *
 * `drizzle-orm/neon-http/migrator` を使い、`__drizzle_migrations` table で適用
 * 履歴を track する標準 migrator に切替え。drizzle-kit migrate の代替として、
 * neon HTTP driver を直接使うので CF Workers / serverless でも動作する形。
 *
 * 動作:
 * - 初回実行時に `drizzle.__drizzle_migrations` table を schema として作成
 * - hash を比較して未適用の migration だけを順次 atomic に適用
 * - 既に適用済の migration は skip (= 何度実行しても idempotent)
 *
 * 使い方: `pnpm --filter @self/db migrate:apply` (DATABASE_URL 必須)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business migrations/*.sql を Neon に incremental 適用する CLI。`__drizzle_migrations` で履歴 track、再実行は idempotent。drizzle-orm/neon-http/migrator を直接利用するので CF Workers と同じ runtime constraint 下で動く
 * @graph-connects neon [calls] @neondatabase/serverless で Postgres に接続
 * @graph-connects drizzle [calls] drizzle-orm/neon-http/migrator で migration 履歴管理
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

/** @graph-connects none */
const here = dirname(fileURLToPath(import.meta.url));
/** @graph-connects none */
const migrationsFolder = join(here, "..", "migrations");

/** @graph-connects none */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set. Source `.envrc` first (direnv allow).");
}

/** @graph-connects none */
const sql = neon(databaseUrl);
/** @graph-connects none */
const db = drizzle(sql);

console.log(`applying migrations from ${migrationsFolder} ...`);
await migrate(db, { migrationsFolder });
console.log("done");
