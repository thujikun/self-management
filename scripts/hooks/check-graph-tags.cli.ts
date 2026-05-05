#!/usr/bin/env tsx
/**
 * `check-graph-tags` の CLI entry。引数なしなら staged file を対象、
 * あれば引数のファイル path を使う。違反があれば exit 1。
 *
 * pure ライブラリ部分は `./check-graph-tags.ts`。
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business @graph-* タグ整合 guard の CLI wrapper。process.argv / staged file 取得 / process.exit を集約し、ライブラリは pure に保つ
 * @graph-connects ./check-graph-tags [calls] runGraphTagsCheck で違反検出
 */

import { execSync } from "node:child_process";
import { runGraphTagsCheck } from "./check-graph-tags.js";

/** @graph-connects none */
function stagedFiles(): string[] {
  const out = execSync("git diff --cached --name-only --diff-filter=ACMR", { encoding: "utf8" });
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

const cliArgs = process.argv.slice(2);
const cliCandidates = cliArgs.length > 0 ? cliArgs : stagedFiles();
const errors = runGraphTagsCheck(cliCandidates);
if (errors.length > 0) {
  console.error("❌ @graph-* タグ整合性違反:");
  for (const e of errors) console.error(`  ${e.file}: ${e.msg}`);
  console.error(
    "\nファイル先頭の JSDoc に @graph-stack / @graph-domain / @graph-business / @graph-connects、" +
      "全トップレベル宣言に @graph-connects (接続なしなら none) を付けてください。",
  );
  process.exit(1);
}
