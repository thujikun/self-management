#!/usr/bin/env tsx
/*
 * `coverage-staged` gate の CLI entry。
 *
 * `scripts/hooks/gates.sh` の cmd_run "coverage-staged" handler から呼ばれる。
 * argv で受けた staged file 群を pure logic (`check-staged-coverage.ts`) に渡し、
 * test file 不在 / vitest exec の 2 段 check を順に踏む。process.exit / spawnSync /
 * 標準出力 etc. の副作用層だけここに置き、純粋ロジックは sibling lib に分離する
 * (compact-log / syndicate と同じ分離 pattern)。
 *
 * 使い方:
 *   pnpm exec tsx scripts/hooks/check-staged-coverage.cli.ts <staged-file-1> <staged-file-2> ...
 *
 * 終了コード:
 *   0: 対象 source なし / 全 file が test 存在 + per-file 90% 通過
 *   1: test file 不在 / coverage threshold 違反 / vitest exec 失敗
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business coverage-staged gate の CLI entry。argv staged files を受けて check-staged-coverage.ts の pure logic に渡し、test file 不在検出 → vitest exec の 2 段で per-file 90% を pre-commit で機械強制する
 * @graph-connects none
 */

import { spawnSync } from "node:child_process";

import {
  buildVitestArgs,
  formatMissingError,
  lookupTestFiles,
  partitionLookups,
} from "./check-staged-coverage.js";

const files = process.argv.slice(2);
if (files.length === 0) {
  // staged file ゼロは noop
  process.exit(0);
}

const { covered } = lookupTestFiles(files);
if (covered.length === 0) {
  // coverage 対象 source が 0 件 (= test file のみ変更 / exclude のみ等) は noop
  process.exit(0);
}

const { missing, sources } = partitionLookups(covered);
if (missing.length > 0) {
  console.error(formatMissingError(missing));
  process.exit(1);
}

// test file が揃っている場合、vitest を coverage 込みで実行
const args = buildVitestArgs(sources);
console.log(`▶ staged coverage check: ${sources.length} file(s) (per-file 90% threshold)`);
const result = spawnSync("pnpm", args, { stdio: "inherit" });
if (result.error) {
  console.error(`vitest exec failed: ${String(result.error)}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
