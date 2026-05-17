#!/usr/bin/env tsx
/**
 * schedule-publish CLI thin entry。`scripts/schedule-publish.ts` の pure 関数を
 * 呼んで、`apps/ryantsuji-dev/web/content/posts/` 内の draft post で publishedAt
 * が現在時刻以下のものから `draft: true` 行を物理的に削除する。
 *
 * 使い方:
 *   pnpm exec tsx scripts/schedule-publish.cli.ts          # default (= 全 lang)
 *   pnpm exec tsx scripts/schedule-publish.cli.ts --dry-run  # 書き換えず print のみ
 *
 * 出力 (commit message 用):
 *   PUBLISHED <slug>.<lang>.md   # 1 行 / 公開した post 1 本
 *   (何も書き換えなければ空 stdout で exit 0)
 *
 * git commit + push は呼び出し側 workflow が `git status --porcelain` で検出して
 * 実施する (= CLI は file write までで終わり、副作用は file system のみ)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business schedule-publish CLI thin entry。process.argv / readFile / writeFile / stdout のみ持ち、pure logic (evaluateDirectory) を呼んで書き換え対象 post を物理的に上書きする。git 操作は呼び出し側 workflow に分離
 * @graph-connects none
 */

import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { evaluateDirectory } from "./schedule-publish.js";

const POSTS_DIR_DEFAULT = "apps/ryantsuji-dev/web/content/posts";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const dirIdx = args.indexOf("--dir");
  const dir = dirIdx >= 0 ? args[dirIdx + 1] : POSTS_DIR_DEFAULT;
  if (!dir) {
    console.error("usage: schedule-publish.cli.ts [--dir <path>] [--dry-run]");
    process.exit(1);
  }
  const absDir = resolve(dir);
  const now = new Date();
  const evaluations = await evaluateDirectory(absDir, now);

  const toPublish = evaluations.filter((e) => e.changed && e.newContent);
  if (toPublish.length === 0) {
    console.log("# schedule-publish: no posts ready for publish");
    return;
  }

  for (const ev of toPublish) {
    const path = join(absDir, ev.filename);
    if (!dryRun) {
      await writeFile(path, ev.newContent ?? "", "utf8");
    }
    console.log(`PUBLISHED ${ev.filename}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
