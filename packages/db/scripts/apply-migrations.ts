/**
 * `migrations/*.sql` を Neon Postgres に **atomic** に適用する。
 *
 * drizzle-kit migrate は TTY 前提で実行できない場面があるため、generated SQL を
 * 直接実行する小さい runner。
 *
 * 安全側ガード:
 * - **pre-flight check**: 本リポジトリの管理 table (`posts` / `comments` / `likes` /
 *   `view_counts`) のいずれかが既に存在したら **早期 exit**。再実行で `CREATE TABLE
 *   ... already exists` を踏ませない (本格運用に切替えたら drizzle-kit migrate
 *   runner に置き換える前提なので、ここは「空 DB / fresh apply」だけを保証する形)。
 * - **transaction**: 各 file 内の statement 群を `sql.transaction([])` で 1
 *   トランザクション化。途中失敗で table が中途半端な状態に残らない。
 *
 * 使い方: `pnpm --filter @self/db migrate:apply` (DATABASE_URL 必須)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business migrations/*.sql を読み込んで Neon に atomic apply する CLI。pre-flight check で再実行を防ぎ、transaction で半適用を防ぐ。本格運用時は drizzle-kit migrate runner に切替予定
 * @graph-connects neon [calls] @neondatabase/serverless で Postgres に transaction で statement 実行
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { neon } from "@neondatabase/serverless";

/** @graph-connects none */
const here = dirname(fileURLToPath(import.meta.url));
/** @graph-connects none */
const migrationsDir = join(here, "..", "migrations");

/** @graph-connects none */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set. Source `.envrc.local` first (direnv allow).");
}

/** @graph-connects none */
const sql = neon(databaseUrl);

/**
 * 本 runner が管理する table 名一覧。pre-flight check の検知対象。
 *
 * @graph-connects none
 */
const MANAGED_TABLES = ["posts", "comments", "likes", "view_counts"] as const;

/**
 * pre-flight: 管理対象 table のいずれかが既に存在したら早期 exit。
 *
 * @graph-connects neon [reads_from] information_schema.tables を select して MANAGED_TABLES の存在確認 (再実行ガード)
 */
const existing = (await sql.query(
  `SELECT table_name FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
  [Array.from(MANAGED_TABLES)],
)) as Array<{ table_name: string }>;
if (existing.length > 0) {
  const names = existing.map((r) => r.table_name).join(", ");
  console.error(
    `existing tables found: ${names}. ` +
      "this runner only supports fresh apply on empty DB. " +
      "switch to drizzle-kit migrate runner for incremental upgrades.",
  );
  process.exit(1);
}

/** @graph-connects none */
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.log("no migrations to apply");
  process.exit(0);
}

for (const file of files) {
  const text = readFileSync(join(migrationsDir, file), "utf8");
  // drizzle-kit は `--> statement-breakpoint` で statement を区切る。
  const statements = text
    .split(/-->\s*statement-breakpoint/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  console.log(`applying ${file} (${statements.length} statements) ...`);
  for (const [i, stmt] of statements.entries()) {
    const head = stmt.split("\n")[0].slice(0, 80);
    console.log(`  [${i + 1}/${statements.length}] ${head}...`);
  }
  // 全 statement を 1 トランザクションに束ねて atomic に適用。途中失敗で table が
  // 半適用状態で残ることを防ぐ。
  await sql.transaction(statements.map((stmt) => sql.query(stmt)));
  console.log(`  ✓ ${file}`);
}

console.log("done");
