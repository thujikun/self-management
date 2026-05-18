/**
 * 認可された CSS custom property (`--name`) のみが `var()` で参照されることを保証する
 * pre-commit gate の pure library。
 *
 * 動機: `var(--未定義token)` は CSS spec 上 `unset` / fallback で silently 解決される
 * ため、typo や rename 漏れが visual bug としてしか観測できず、git history を辿るまで
 * 原因が分からない。lint で機械的に潰す。
 *
 * 仕組み:
 * 1. **declarations** — 引数で渡された css source 群の `--name:` 宣言を全部集める。
 *    `@self/design-tokens/dist/tokens.css` (semantic / primitive 両方) + author の
 *    own css の `:root` / `@theme` ブロック等が source。
 * 2. **references** — author の own css から `var(--name)` の参照を全部抜き出す
 *    (fallback 付き `var(--x, fallback)` も同じく x を参照として扱う、fallback が
 *    効くなら宣言済みであるべき)。
 * 3. **dynamic prefix の除外** — `--tw-*` は Tailwind が runtime に set、`--shiki-*`
 *    は shiki が inline style で set するため declaration は静的に見つからない。
 *    これらを allowlist として除外する。
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business 未定義 CSS custom property への `var()` 参照を pre-commit で機械的に弾く pure helper。`--tw-*` / `--shiki-*` 等 runtime-injected な prefix を allowlist で除外、それ以外で未宣言 token への参照があれば violation として返す。CLI 層が exit code 1 で commit を止める
 * @graph-connects none
 */

/** @graph-connects none */
export interface CssTokenViolation {
  file: string;
  line: number;
  token: string;
}

/** @graph-connects none */
export interface CheckCssTokensInput {
  /** declarations 抽出対象。design-tokens dist + author own css 等を全部渡す */
  declarationSources: Array<{ file: string; content: string }>;
  /** references 抽出対象 (= author own css)。declaration source と重複しても問題ない */
  referenceSources: Array<{ file: string; content: string }>;
  /** runtime-injected で declaration が静的に存在しない prefix 群。e.g. ["--tw-", "--shiki-"] */
  dynamicPrefixes: readonly string[];
}

/**
 * Tailwind / shiki / 第三者 CSS が runtime に inject する `--name` の prefix。これらは
 * 静的 declaration が source に存在しないため、参照だけ見つけても違反としない。
 *
 * @graph-connects none
 */
export const DEFAULT_DYNAMIC_PREFIXES: readonly string[] = ["--tw-", "--shiki-", "--default-"];

/**
 * CSS 文字列から `--name:` の **宣言** を全部集めて Set として返す。
 * `var(--name)` のような参照は対象外。
 *
 * @graph-connects none
 */
export function extractDeclarations(css: string): Set<string> {
  const out = new Set<string>();
  // `--name:` を行頭 / `{` 直後 / `;` 直後で検出。`var(--name)` の `--name` には
  // hit しないよう、`var(` を含む行は除外する。
  const re = /(?:^|[{;\s])(--[a-z0-9_-]+)\s*:/gimu;
  let m;
  while ((m = re.exec(css)) !== null) {
    out.add(m[1] as string);
  }
  return out;
}

/**
 * CSS 文字列から `var(--name)` の **参照** を全部集めて返す。fallback の `--y` も
 * 同じ Set に入れる (= fallback も宣言済みであるべき token であってほしい)。
 *
 * 戻り値は `{ token, line }` の配列。同じ token が複数行に出る場合は複数 entry。
 *
 * @graph-connects none
 */
export function extractReferences(css: string): Array<{ token: string; line: number }> {
  const stripped = stripCssComments(css);
  const out: Array<{ token: string; line: number }> = [];
  const lines = stripped.split("\n");
  const re = /var\(\s*(--[a-z0-9_-]+)/gimu;
  lines.forEach((lineStr, i) => {
    let m;
    while ((m = re.exec(lineStr)) !== null) {
      out.push({ token: m[1] as string, line: i + 1 });
    }
    re.lastIndex = 0;
  });
  return out;
}

/**
 * CSS の `/* ... *\/` を空白に置換 (改行数は保持して line 番号を狂わせない)。
 *
 * @graph-connects none
 */
export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//gu, (match) => match.replace(/[^\n]/gu, " "));
}

/**
 * 入力 source から declarations / references を抜き出し、未宣言の参照を返す。
 *
 * @graph-connects none
 */
export function checkCssTokens(input: CheckCssTokensInput): CssTokenViolation[] {
  const declared = new Set<string>();
  for (const src of input.declarationSources) {
    for (const name of extractDeclarations(src.content)) declared.add(name);
  }

  const violations: CssTokenViolation[] = [];
  for (const src of input.referenceSources) {
    for (const ref of extractReferences(src.content)) {
      if (declared.has(ref.token)) continue;
      if (input.dynamicPrefixes.some((p) => ref.token.startsWith(p))) continue;
      violations.push({ file: src.file, line: ref.line, token: ref.token });
    }
  }
  return violations;
}
