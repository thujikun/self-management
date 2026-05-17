/**
 * staged source files の coverage check (pure logic 層)。
 *
 * pre-commit `coverage-staged` gate の中身。staged な `.ts` / `.tsx` 群を受け取り:
 *   1. 各 source file に対応する test file (`<name>.test.ts(x)`) が存在するか確認
 *   2. vitest コマンド (`--related <files> --coverage --coverage.include=<each>
 *      --coverage.thresholds.perFile=true ...=90`) を組み立てて呼び出し可能な形で返す
 *
 * 実 exec は `.cli.ts` 側に置き、本 module は組立 + filter 判定の pure logic を
 * 担う (test 容易性のため)。CLI entry は `scripts/hooks/check-staged-coverage.cli.ts`。
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business staged file 限定の per-file 90% coverage check の pure logic。test file の存在判定と vitest CLI 引数の組立てを担い、CI test-coverage と同じ exclude / threshold (coverage-config.ts SSoT) で「修正したファイルが test 未付随 / 90% 未達」を pre-commit で検出する
 * @graph-connects none
 */

import { existsSync } from "node:fs";

import { candidateTestFiles, isCovered } from "./coverage-config.js";

/**
 * source file path に対する test file 存在 check の結果。
 *
 * - `present`: 候補のいずれかが exist する場合、その path
 * - `missing`: いずれも無い場合、`null`
 *
 * @graph-connects none
 */
export interface TestFileLookup {
  source: string;
  testFile: string | null;
}

/**
 * 与えた source files のうち coverage 対象だけ filter し、各 file に test file が
 * 存在するかを判定して返す。
 *
 * @graph-connects none
 */
export function lookupTestFiles(
  sources: readonly string[],
  fileExists: (p: string) => boolean = existsSync,
): { covered: TestFileLookup[]; skipped: string[] } {
  const covered: TestFileLookup[] = [];
  const skipped: string[] = [];
  for (const s of sources) {
    if (!isCovered(s)) {
      skipped.push(s);
      continue;
    }
    const candidates = candidateTestFiles(s);
    const found = candidates.find((c) => fileExists(c)) ?? null;
    covered.push({ source: s, testFile: found });
  }
  return { covered, skipped };
}

/**
 * test file が無い source の path 一覧 (= error 対象) と、見つかった test files の
 * 一覧 (= vitest `--related` に渡す候補) を分けて返す。
 *
 * @graph-connects none
 */
export function partitionLookups(lookups: readonly TestFileLookup[]): {
  missing: string[];
  testFiles: string[];
  sources: string[];
} {
  const missing: string[] = [];
  const testFiles: string[] = [];
  const sources: string[] = [];
  for (const l of lookups) {
    if (l.testFile == null) {
      missing.push(l.source);
    } else {
      testFiles.push(l.testFile);
      sources.push(l.source);
    }
  }
  return { missing, testFiles, sources };
}

/**
 * `pnpm exec vitest run` に渡す引数列を組立てる。`--related <sources>` で staged
 * source を import する test だけ拾い、`--coverage.include=<each>` で coverage
 * 集計対象を staged source に絞り、per-file 90% threshold で fail させる。
 *
 * `pnpm test:coverage` (= full mode) と違って `pnpm turbo run build` を prepend
 * しないのは、staged check は incremental が前提で、dist build 必要なら他の gate
 * (build / typecheck) が CI 側で担保するため。
 *
 * @graph-connects none
 */
export function buildVitestArgs(sources: readonly string[]): string[] {
  const includeArgs: string[] = [];
  for (const s of sources) {
    includeArgs.push(`--coverage.include=${s}`);
  }
  // vitest v4 では `vitest related <files>` がサブコマンド形式。CLI 引数列は
  // `exec vitest related <coverage flags> <sources...>` の順で組む。`related` は
  // 与えた source を import する test file だけを走らせるので、staged scope と
  // 親和する (= cold start + 数 test だけで完結し、全 suite を流すより速い)。
  return [
    "exec",
    "vitest",
    "related",
    "--coverage",
    "--coverage.thresholds.perFile=true",
    "--coverage.thresholds.lines=90",
    "--coverage.thresholds.functions=90",
    "--coverage.thresholds.branches=90",
    "--coverage.thresholds.statements=90",
    ...includeArgs,
    ...sources,
  ];
}

/**
 * error 出力用に「test file が無い source 一覧」を整形する。
 *
 * @graph-connects none
 */
export function formatMissingError(missing: readonly string[]): string {
  const lines = ["❌ Test file missing for staged source(s):"];
  for (const m of missing) {
    lines.push(`  - ${m} (expected ${candidateTestFiles(m).join(" or ")})`);
  }
  lines.push(
    "",
    "対応する `*.test.ts(x)` を同階層に追加してください。coverage 対象外にしたい場合は",
    "`scripts/hooks/coverage-config.ts` の `COVERAGE_EXCLUDE` に追記 + 理由 comment を併記。",
  );
  return lines.join("\n");
}
