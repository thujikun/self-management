#!/usr/bin/env tsx
/*
 * check-covers-exist CLI thin entry。content/posts/*.{ja,en}.md を全列挙し、
 * `apps/ryantsuji-dev/web/public/posts/<slug>.<lang>.cover.png` の存在を確認、
 * 欠けていれば exit 1 で fail させる。
 *
 * 使い方:
 *   pnpm tsx scripts/check-covers-exist.cli.ts        # 全 post を check
 *
 * gates.sh の `covers-exist` gate (= pre-commit + CI) から呼ばれる。`pnpm
 * covers:generate` を手動で踏まずに content を merge する事故 (og:image 404)
 * を merge 前に弾く。
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business check-covers-exist の filesystem 実行 entry。pnpm covers:generate 未実行で content を merge する事故 (og:image 404) を gate で防ぐ
 * @graph-connects none
 */

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { findMissingCovers, type PostEntry } from "./check-covers-exist.js";
import { readAllPosts } from "./syndicate.js";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPTS_DIR, "..");
const PUBLIC_POSTS_DIR = resolve(REPO_ROOT, "apps/ryantsuji-dev/web/public/posts");

async function main(): Promise<void> {
  // covers は syndication 可否に関わらず全 post 必要 (ryantsuji.dev は独自 cover で
  // unfurl するため)。`includeExcluded: true` で `excludeFromSyndication: true` の
  // post も拾う。draft (default で除外) は public 露出しないので check 対象外で OK。
  const posts = await readAllPosts(undefined, { includeExcluded: true });
  const entries: PostEntry[] = posts.map((p) => ({ slug: p.slug, lang: p.lang }));

  const missing = findMissingCovers(entries, (publicPath) =>
    existsSync(resolve(PUBLIC_POSTS_DIR, publicPath.replace(/^\/posts\//, ""))),
  );

  if (missing.length === 0) {
    console.log(`✓ cover PNG exists for all ${entries.length} post entries`);
    return;
  }

  console.error(`❌ ${missing.length} cover PNG file(s) missing in ${PUBLIC_POSTS_DIR}:`);
  for (const m of missing) {
    console.error(`  - ${m.slug}.${m.lang} → expected ${m.publicPath}`);
  }
  console.error("\nRun: pnpm covers:generate");
  process.exit(1);
}

await main();
