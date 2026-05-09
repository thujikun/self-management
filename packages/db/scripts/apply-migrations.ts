/**
 * `migrations/*.sql` を Neon Postgres に順次適用する。
 *
 * drizzle-kit migrate は TTY 前提で実行できない場面があるため、generated SQL を
 * 直接実行する小さい runner。再実行は冪等にするため `__drizzle_migrations` 風の
 * 履歴 table を持つのではなく、現状は **空 DB に対する初期 apply** のみ想定する
 * (本格運用に入ったら drizzle-kit の migrate runner に切り替える)。
 *
 * 使い方: `pnpm --filter @self/db migrate:apply` (DATABASE_URL 必須)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business migrations/*.sql を読み込んで Neon に順次 apply する CLI。drizzle-kit push の TTY 制約を回避し、空 DB / fresh apply に最小工数で当てる。本格運用は drizzle-kit migrate runner に切替予定
 * @graph-connects neon [calls] @neondatabase/serverless で Postgres に直接 statement 実行
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

/** @graph-connects none */
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.log("no migrations to apply");
  process.exit(0);
}

for (const file of files) {
  console.log(`applying ${file} ...`);
  const text = readFileSync(join(migrationsDir, file), "utf8");
  // drizzle-kit は `--> statement-breakpoint` で statement を区切る。
  const statements = text
    .split(/-->\s*statement-breakpoint/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    await sql.query(stmt);
  }
  console.log(`  ✓ ${file}`);
}

console.log("done");
