/**
 * 認可された CSS custom property (`--name`) のみが `var()` で参照されることを保証する
 * pre-commit gate の library。
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
 * 副作用: `runCheckCssTokens` は default で `node:fs` を叩く (injection 化済み、
 * test では fake で差し替える)。それ以外は pure。
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business 未定義 CSS custom property への `var()` 参照を pre-commit で機械的に弾く helper。`--tw-*` / `--shiki-*` 等 runtime-injected な prefix を allowlist で除外、それ以外で未宣言 token への参照があれば violation として返す。CLI 層は runCheckCssTokens を呼んで exit code を返すだけの thin wrapper
 * @graph-connects none
 */

import { existsSync, readFileSync } from "node:fs";

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
 * - `--tw-*`: Tailwind v4 が arbitrary value / modifier の wiring 用に set
 *   (e.g. `--tw-bg-opacity`, `--tw-text-color`)。
 * - `--shiki-*`: shiki syntax highlighter が code block の inline style として set
 *   (light/dark テーマ切替で `--shiki-light` / `--shiki-dark` を参照)。
 * - `--default-*`: Tailwind v4 の preflight (`@layer base`) が default value として
 *   inject する系 (e.g. `--default-font-family-sans`, `--default-mono-font-family`)。
 *   semantic token 側で参照する場合があるが、宣言は Tailwind runtime 任せ。
 *
 * @graph-connects none
 */
export const DEFAULT_DYNAMIC_PREFIXES: readonly string[] = ["--tw-", "--shiki-", "--default-"];

/**
 * CSS 文字列から `--name:` の **宣言** を全部集めて Set として返す。
 * `var(--name)` のような参照は対象外。
 *
 * 冒頭でコメントを strip するのは `extractReferences` との対称性のため。コメント内の
 * 例示 (e.g. `/* --foo: 1px; *\/`) を宣言として false positive に取り込まないようにする
 * (取り込むと「コメントで書いた token は declare 扱いになる」hole になり、未来の参照を
 * silently pass させてしまう)。
 *
 * @graph-connects none
 */
export function extractDeclarations(css: string): Set<string> {
  const stripped = stripCssComments(css);
  const out = new Set<string>();
  // `--name:` を行頭 / `{` 直後 / `;` 直後で検出。`var(--name)` の `--name` には
  // hit しないよう、`var(` を含む行は除外する。
  const re = /(?:^|[{;\s])(--[a-z0-9_-]+)\s*:/gimu;
  let m;
  while ((m = re.exec(stripped)) !== null) {
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

/** @graph-connects none */
export interface RunCheckCssTokensOptions {
  /** CLI 引数列 (`process.argv.slice(2)` 相当)。`.css` で終わるものだけが対象に拾われる */
  args: readonly string[];
  /** design-tokens dist が書き出す全 token を含む CSS path (= SoT) */
  designTokensCssPath: string;
  /** test 用 injection。default は `node:fs.existsSync` */
  fileExists?: (path: string) => boolean;
  /** test 用 injection。default は `node:fs.readFileSync(path, "utf8")` */
  readFile?: (path: string) => string;
}

/** @graph-connects none */
export interface RunCheckCssTokensResult {
  exitCode: number;
  /** stderr に流す行 (空配列なら何も出さない) */
  stderr: readonly string[];
}

/**
 * CLI 層の orchestration を pure 関数化したもの。fs 操作は injection 可能なので
 * test で fake を差し替えられる。`*.cli.ts` 側は本関数を呼んで stderr を出し
 * `process.exit(exitCode)` するだけの 4-5 行 wrapper。
 *
 * 振る舞い:
 *   - `args` に `.css` で終わるものが 1 つも無ければ exit 0 (no-op、staged mode で
 *     css 変更が無いコミットを通すため)
 *   - design-tokens dist が **存在しなければ exit 1** (fail-fast)。silent skip すると
 *     semantic token 100+ 件を未宣言と誤検出するため pre-commit と CI で挙動が drift
 *     する。dist が無い時は明確な error message と build コマンドを出す
 *   - dist あり + violation 0 → exit 0
 *   - dist あり + violation 1+ → exit 1 と violation 列を stderr に出す
 *
 * @graph-connects ./check-css-tokens [calls] checkCssTokens で実 violation 判定を実行
 */
export function runCheckCssTokens(opts: RunCheckCssTokensOptions): RunCheckCssTokensResult {
  const fileExists = opts.fileExists ?? existsSync;
  const readFile = opts.readFile ?? ((p: string) => readFileSync(p, "utf8"));

  const targets = opts.args.filter((a) => a.endsWith(".css"));
  if (targets.length === 0) {
    return { exitCode: 0, stderr: [] };
  }

  if (!fileExists(opts.designTokensCssPath)) {
    return {
      exitCode: 1,
      stderr: [
        `✗ check-css-tokens: ${opts.designTokensCssPath} not found.`,
        `  design-tokens dist 不在で実行すると semantic token 100+ 件を未宣言と誤検出するため fail-fast します。`,
        `  fix: \`pnpm --filter @self/design-tokens build:css\` を先に流してください。`,
      ],
    };
  }

  const declarationSources: Array<{ file: string; content: string }> = [
    { file: opts.designTokensCssPath, content: readFile(opts.designTokensCssPath) },
  ];
  const referenceSources: Array<{ file: string; content: string }> = [];
  for (const t of targets) {
    if (!fileExists(t)) continue;
    const content = readFile(t);
    declarationSources.push({ file: t, content });
    referenceSources.push({ file: t, content });
  }

  const violations = checkCssTokens({
    declarationSources,
    referenceSources,
    dynamicPrefixes: DEFAULT_DYNAMIC_PREFIXES,
  });

  if (violations.length === 0) {
    return { exitCode: 0, stderr: [] };
  }

  const stderr: string[] = [
    "✗ check-css-tokens: undefined CSS custom property reference(s) found:",
    "",
  ];
  for (const v of violations) {
    stderr.push(`  ${v.file}:${v.line}  var(${v.token})  ← not declared`);
  }
  stderr.push(
    "",
    "  fix: 有効な token に置換するか、`packages/design-tokens` の semantic token に追加",
    "       (runtime に inject される `--tw-*` / `--shiki-*` 等は cli の dynamicPrefixes に追加)",
  );
  return { exitCode: 1, stderr };
}
