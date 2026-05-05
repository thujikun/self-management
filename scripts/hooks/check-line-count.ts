#!/usr/bin/env tsx
/**
 * 各ファイルの「コード行数」が CAP を超えていないかを検証する pre-commit guard。
 *
 * グローバル CLAUDE.md ルール: 「コード行 500 行 (コメント行・空行を除く)」。
 * 超える場合はファイル分割を計画に含めること。
 *
 * カウント規則:
 * - 空行は除外
 * - 行コメント (`// ...` / `# ...`) は除外
 * - ブロックコメント (`/ * ... * /`) は除外 (複数行に渡るものも全て)
 * - markdown / YAML / JSON 等のコメントなし系も対象だが、対象拡張子で絞る
 *
 * 対象拡張子: .ts .tsx .js .jsx .mjs .cjs .sh .py
 *
 * 引数なし時は staged ファイルを対象に取る。引数あり時は引数のファイルパスを使う。
 * `CAP` env で閾値を override 可能 (デフォルト 500)。
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business グローバル CLAUDE.md の「ファイル 500 行制限」を pre-commit で機械強制する guard。コメント行を除外した実コード行のみカウントし、超過ファイルを exit 1 で commit ブロック
 * @graph-connects none
 */

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { extname } from "node:path";

/** @graph-connects none */
const CAP = Number(process.env.CAP ?? "500");

/** @graph-connects none */
const TARGET_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sh", ".py"]);

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

/**
 * 指定ファイルの「コード行」を数える (空行・コメント行を除外)。
 *
 * 単純化のため `// ...` / `# ...` の行頭を行コメント、
 * `/ *` から始まり `* /` で終わるブロックを跨いだ全行をブロックコメントとみなす。
 * ロジックを精緻化する代わりに「コメント行は積極的に除外する」スタンス。
 *
 * @graph-connects none
 */
function countCodeLines(path: string): number {
  if (!existsSync(path)) return 0;
  const src = readFileSync(path, "utf8");
  const ext = extname(path);
  let inBlock = false;
  let count = 0;
  for (const rawLine of src.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    // ブロックコメント中
    if (inBlock) {
      if (line.includes("*/")) {
        inBlock = false;
        // ブロック終端と同じ行にコード本体があるかは一旦考慮しない (エッジケース)
      }
      continue;
    }

    // ブロックコメント開始 (1 行で完結しないもの)
    if (line.startsWith("/*") && !line.includes("*/")) {
      inBlock = true;
      continue;
    }

    // 1 行で完結するブロックコメント `/* ... */` は除外
    if (line.startsWith("/*") && line.includes("*/")) continue;

    // 行コメント
    if (ext === ".sh" || ext === ".py") {
      if (line.startsWith("#")) continue;
    } else {
      if (line.startsWith("//")) continue;
    }

    // JSDoc 行 (`* foo`) — ブロックコメント中のはずだが、念のため
    if (line.startsWith("*") && !line.startsWith("*/")) continue;

    count++;
  }
  return count;
}

/**
 * メイン: 対象ファイルを iterate し、超過があれば exit 1。
 *
 * @graph-connects none
 */
function main(): void {
  const args = process.argv.slice(2);
  const files = (args.length > 0 ? args : stagedFiles()).filter((f) => TARGET_EXT.has(extname(f)));

  let failed = false;
  for (const f of files) {
    const n = countCodeLines(f);
    if (n > CAP) {
      console.error(`❌ ${f}: ${n} code lines > cap=${CAP} (split the file)`);
      failed = true;
    }
  }
  if (failed) {
    console.error(
      `\n超過ファイルがあります。グローバル CLAUDE.md ルール「コード行 500 行 (コメント・空行除く)」遵守のため分割してください。`,
    );
    process.exit(1);
  }
}

main();
