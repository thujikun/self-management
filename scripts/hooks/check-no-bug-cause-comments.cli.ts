#!/usr/bin/env tsx
/**
 * check-no-bug-cause-comments CLI thin entry。`process.argv` から staged file path を
 * 受け取り、`findBugCauseInContent` を回して hit があれば 1 行 1 件で stderr に
 * 出力して exit 1。
 *
 * 想定呼び出し: `scripts/hooks/gates.sh` から `bash`/`pnpm exec tsx` 経由。
 *
 * @graph-stack core
 * @graph-domain devops
 * @graph-business check-no-bug-cause-comments CLI thin entry。argv / readFile / stdout 専用の glue で、pure logic (findBugCauseInContent) を呼んで違反を file:line で報告。pre-commit gate と CI matrix から同 binary で呼べる
 * @graph-connects none
 */

import { readFile } from "node:fs/promises";

import { findBugCauseInContent, shouldScan } from "./check-no-bug-cause-comments.js";

async function main(): Promise<void> {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    process.exit(0);
  }
  let totalHits = 0;
  for (const file of files) {
    if (!shouldScan(file)) continue;
    let content: string;
    try {
      content = await readFile(file, "utf8");
    } catch {
      continue;
    }
    const hits = findBugCauseInContent(content);
    for (const h of hits) {
      console.error(`${file}:${h.line}: ${h.matched} — ${h.description}`);
      totalHits += 1;
    }
  }
  if (totalHits > 0) {
    console.error(
      `\n❌ ${totalHits} bug-cause / 過去経緯コメントが検出されました。コメントは現状の意図のみ。bug 経緯は PR description / commit body へ。`,
    );
    process.exit(1);
  }
}

await main();
