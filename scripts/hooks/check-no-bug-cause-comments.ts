/**
 * code comment 内に bug-cause / 過去経緯系の語句が紛れていないか検査する pure
 * 関数群。`scripts/hooks/check-no-bug-cause-comments.cli.ts` から呼ばれる。
 *
 * 対象: `.ts` / `.tsx` (実装ファイル)。テスト fixture / docs (.md) は対象外。
 *
 * scope: 行頭の `//` / `/*` / `*` で始まる行 (= comment) のみを走査。本文中の
 * 自然語に同じ文字列が現れても hit させない。
 *
 * pattern 設計: 高 signal / 低 false-positive な日本語/英語のフレーズに絞り、
 * 普通の「現状の意図」コメントを誤検知しない粒度に保つ。新規 pattern 追加は
 * test 同時更新を要求する形にする (= test snapshot で SoT を固定)。
 *
 * @graph-stack core
 * @graph-domain devops
 * @graph-business code comment policy の機械強制。過去実装の対比 / 履歴トーン / issue 番号参照といった典型句を staged diff の comment 行に対して regex 検出し、過去経緯コメントが PR を通り抜けないようにする pure logic (具体 pattern は BUG_CAUSE_PATTERNS / 期待挙動は test を参照)
 * @graph-connects none
 */

/**
 * bug-cause を示唆する典型句。pattern 自体が SoT。
 *
 * @graph-connects none
 */
export const BUG_CAUSE_PATTERNS: ReadonlyArray<{ pattern: RegExp; description: string }> =
  Object.freeze([
    {
      pattern: /旧実装で/u,
      description: "'旧実装で' は過去経緯の参照。コメントは現状の意図のみを書く。",
    },
    {
      pattern: /以前は[^\n]{0,80}(?:していた|だった|あった|でした)/u,
      description: "'以前は…していた' は過去経緯の対比。コメントは現状の意図のみを書く。",
    },
    {
      pattern: /かつては/u,
      description: "'かつては' は過去経緯の参照。コメントは現状の意図のみを書く。",
    },
    {
      pattern: /\b(?:bugfix|bug-fix)\b/iu,
      description: "'bugfix' は履歴トーン。PR description / commit body に逃がす。",
    },
    {
      pattern: /\bfix(?:es)?\s+for\s+(?:the\s+)?(?:bug|issue|crash|error)\b/iu,
      description: "'fix for the bug/issue/crash' は履歴トーン。",
    },
    {
      pattern: /\bfix(?:es)?\s+#\d+/iu,
      description: "'fix #123' のような issue 番号参照は履歴トーン。",
    },
    {
      pattern: /\boriginally\s+(?:we|i|the\s+\w+)\s+\w+ed\b/iu,
      description: "'originally we …ed' は過去経緯の対比。",
    },
    {
      pattern: /\bwas\s+failing\s+because\b/iu,
      description: "'was failing because' は bug-cause 説明。",
    },
    {
      pattern: /\bused\s+to\s+\w+\b/iu,
      description: "'used to …' は過去経緯の対比。",
    },
  ]);

/**
 * 1 行分の文字列が comment 行かどうか (line `//`、block 開始 `/` + `*`、block 中
 * の `*` 行、block 終了 `*` + `/` のいずれか) を判定する。
 *
 * @graph-connects none
 */
export function isCommentLine(line: string): boolean {
  return /^\s*(?:\/\/|\/\*|\*\/?|\*\s)/u.test(line);
}

/**
 * 1 ファイル分の content を走査し、bug-cause 系の hit を返す。各 hit には
 * 1-based line 番号、マッチ抜粋、説明を含める。hit ゼロなら空配列。
 *
 * @graph-connects none
 */
export interface BugCauseHit {
  line: number;
  matched: string;
  description: string;
}

/** @graph-connects none */
export function findBugCauseInContent(content: string): BugCauseHit[] {
  const lines = content.split(/\r?\n/u);
  const hits: BugCauseHit[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) continue;
    if (!isCommentLine(line)) continue;
    for (const { pattern, description } of BUG_CAUSE_PATTERNS) {
      const m = line.match(pattern);
      if (m && m[0]) {
        hits.push({ line: i + 1, matched: m[0], description });
      }
    }
  }
  return hits;
}

/**
 * 検査対象 file path かどうか。`.ts` / `.tsx` で、test / fixture / dist 系を除く。
 *
 * @graph-connects none
 */
export function shouldScan(path: string): boolean {
  if (!/\.(?:ts|tsx)$/u.test(path)) return false;
  if (/\.test\.(?:ts|tsx)$/u.test(path)) return false;
  if (/\.spec\.(?:ts|tsx)$/u.test(path)) return false;
  if (/(?:^|\/)(?:dist|node_modules|coverage|__fixtures__|fixtures)\//u.test(path)) return false;
  return true;
}
