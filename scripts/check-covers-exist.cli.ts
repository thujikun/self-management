#!/usr/bin/env tsx
/*
 * check-covers-exist CLI thin entry。content/posts/*.{ja,en}.md を全列挙し、
 * content submodule の `apps/ryantsuji-dev/web/content/images/posts/<slug>.<lang>.cover.png`
 * の存在を確認、欠けていれば exit 1 で fail させる。
 *
 * 使い方:
 *   pnpm tsx scripts/check-covers-exist.cli.ts        # 全 post を check
 *
 * gates.sh の `covers-exist` gate (= pre-commit + CI) から呼ばれる。content repo
 * (ryantsuji-dev-content) 側で `node scripts/generate-cover.mjs` を踏まずに
 * submodule pointer を bump する事故 (og:image 404) を merge 前に弾く。
 *
 * 注: `@self/content` には依存しない (= dist build を要求しない)。CI matrix で
 * `gate (build)` と並列に走らせるため、`@self/content/dist` 不在でも単体起動できる
 * 経路を保つ。post 列挙は `scripts/posts-files.ts` の lightweight 層に閉じ込め、
 * 本 CLI は filesystem 述語 (existsSync) と stdout 整形だけを担う。
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business check-covers-exist の filesystem 実行 entry。content repo (ryantsuji-dev-content) 側 `scripts/generate-cover.mjs` 未実行で submodule pointer を bump する事故 (og:image 404) を gate で防ぐ。`@self/content` 非依存で CI build 並列起動に対応
 * @graph-connects none
 */

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { findMissingCovers } from "./check-covers-exist.js";
import { listPostFiles } from "./posts-files.js";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPTS_DIR, "..");
// 2026-05 に cover 生成の責務を content repo (ryantsuji-dev-content) に移行したのに
// 合わせて、PNG の存在 check も content submodule の images/posts/ 配下を見るよう変更。
// 旧 path (`apps/ryantsuji-dev/web/public/posts/`) は migration cleanup で消える想定。
const CONTENT_IMAGES_POSTS_DIR = resolve(REPO_ROOT, "apps/ryantsuji-dev/web/content/images/posts");

async function main(): Promise<void> {
  // covers は syndication 可否・draft 可否に関わらず全 post 必要 (ryantsuji.dev は独自
  // cover で unfurl するため)。draft も要求するのは、draft で cover 無しのまま merge され
  // publishedAt 到達で published に flip した瞬間に cover が 404 になる事故を防ぐため。
  // `_` prefix の test fixture は findMissingCovers の `shouldHaveCover` が skip する。
  const entries = await listPostFiles();

  const missing = findMissingCovers(entries, (publicPath) =>
    existsSync(resolve(CONTENT_IMAGES_POSTS_DIR, publicPath.replace(/^\/images\/posts\//, ""))),
  );

  if (missing.length === 0) {
    console.log(`✓ cover PNG exists for all ${entries.length} post entries`);
    return;
  }

  console.error(`❌ ${missing.length} cover PNG file(s) missing in ${CONTENT_IMAGES_POSTS_DIR}:`);
  for (const m of missing) {
    console.error(`  - ${m.slug}.${m.lang} → expected ${m.publicPath}`);
  }
  console.error(
    "\nContent repo (ryantsuji-dev-content) で `node scripts/generate-cover.mjs` を実行してください",
  );
  process.exit(1);
}

await main();
