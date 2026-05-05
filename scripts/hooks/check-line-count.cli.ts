#!/usr/bin/env tsx
/**
 * `check-line-count` の CLI entry。引数なしなら staged file を対象、
 * あれば引数のファイル path を使う。`CAP` env で閾値を override 可能。
 *
 * 違反があれば exit 1。pure ライブラリ部分は `./check-line-count.ts`。
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business 行数 cap guard の CLI wrapper。process.argv / staged file 取得 / process.exit を集約し、ライブラリは pure に保つ
 * @graph-connects ./check-line-count [calls] runLineCountCheck で行数検証
 */

import { execSync } from "node:child_process";
import { DEFAULT_CAP, runLineCountCheck } from "./check-line-count.js";

/**
 * staged 状態の changed-file 一覧を返す。
 *
 * @graph-connects none
 */
function stagedFiles(): string[] {
  const out = execSync("git diff --cached --name-only --diff-filter=ACMR", { encoding: "utf8" });
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

const cap = Number(process.env.CAP ?? DEFAULT_CAP);
const cliArgs = process.argv.slice(2);
const cliFiles = cliArgs.length > 0 ? cliArgs : stagedFiles();
const failures = runLineCountCheck(cliFiles, cap);
if (failures > 0) process.exit(1);
