#!/usr/bin/env tsx
/**
 * 各ファイルの「コード行数」が CAP を超えていないかを検証する pure library。
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
 * CLI 実行は `check-line-count.cli.ts` 経由。本ファイルは pure helper のみで副作用なし。
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business グローバル CLAUDE.md の「ファイル 500 行制限」を pre-commit で機械強制する guard の純粋ライブラリ部。コメント行を除外した実コード行のみカウントし、CLI 側で違反時に exit 1 する設計
 * @graph-connects none
 */

import { readFileSync, existsSync } from "node:fs";
import { extname } from "node:path";

/** @graph-connects none */
export const DEFAULT_CAP = 500;

/** @graph-connects none */
export const TARGET_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sh", ".py"]);

/**
 * 指定ファイルの「コード行」を数える (空行・コメント行を除外)。
 *
 * 単純化のため `// ...` / `# ...` の行頭を行コメント、
 * `/ *` から始まり `* /` で終わるブロックを跨いだ全行をブロックコメントとみなす。
 * ロジックを精緻化する代わりに「コメント行は積極的に除外する」スタンス。
 *
 * @graph-connects none
 */
export function countCodeLines(path: string): number {
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
 * 対象ファイル群に対し行数チェックを実行し、超過したファイル数を返す。
 * 副作用は console.error のみ (process.exit はしない)。
 *
 * @graph-connects none
 */
export function runLineCountCheck(files: string[], cap: number = DEFAULT_CAP): number {
  const targets = files.filter((f) => TARGET_EXT.has(extname(f)));
  let overCount = 0;
  for (const f of targets) {
    const n = countCodeLines(f);
    if (n > cap) {
      console.error(`❌ ${f}: ${n} code lines > cap=${cap} (split the file)`);
      overCount++;
    }
  }
  if (overCount > 0) {
    console.error(
      `\n超過ファイルがあります。グローバル CLAUDE.md ルール「コード行 500 行 (コメント・空行除く)」遵守のため分割してください。`,
    );
  }
  return overCount;
}
