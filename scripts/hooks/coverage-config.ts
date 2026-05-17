/**
 * coverage 計測の include / exclude / threshold を vitest config と staged 用
 * coverage check 両方から参照する SSoT。
 *
 * `vitest.config.ts` の `coverage` 設定と `scripts/hooks/check-staged-coverage.cli.ts`
 * の filter 判定が drift しないよう、両者は本 module から import する。新規 exclude
 * 追加 / 変更はここで 1 箇所だけ編集すれば自動的に CI (full coverage) と pre-commit
 * (staged coverage) 双方に反映される。
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business coverage include / exclude / threshold の SSoT。vitest.config.ts と check-staged-coverage.cli.ts が drift せず両方同じ exclude 判定で動くように 1 箇所集約。pre-commit と CI で per-file 90% の対象集合が同一になる
 * @graph-connects none
 */

/**
 * coverage 対象 (include)。glob pattern (vitest が解釈)。
 *
 * @graph-connects none
 */
export const COVERAGE_INCLUDE: readonly string[] = [
  "apps/**/src/**/*.{ts,tsx}",
  "apps/ryantsuji-dev/web/vite-plugins/**/*.ts",
  "packages/**/src/**/*.{ts,tsx}",
  "scripts/hooks/**/*.ts",
  "infra/**/*.ts",
];

/**
 * coverage 対象外 (exclude)。glob pattern (vitest が解釈)。
 *
 * 各エントリの rationale はインライン comment 参照。新規 exclude を追加する時は
 * **理由を必ず併記する** (将来の Ryan が判断できるよう)。
 *
 * @graph-connects none
 */
export const COVERAGE_EXCLUDE: readonly string[] = [
  "**/*.test.ts",
  "**/*.spec.ts",
  "**/dist/**",
  "**/node_modules/**",
  // SDK ラッパー: BigQuery / Vertex AI への外部 HTTP 呼び出しが本体で、
  // 純粋ロジック部分は parser 側 (operations-log/threads/memory/strategy) で
  // 既にテスト対象。ここの unit test は real-API 統合テストか E2E でやる。
  "apps/graph/product/src/migrate/common/bq-merge.ts",
  "apps/graph/product/src/migrate/common/embedding.ts",
  // ryantsuji-dev/web の DB / 認証 runtime ラッパー: Drizzle/Neon HTTP / Better Auth
  // への外部 IO が本体。pure 入力 validation は engagement-validate.ts に切出してテスト
  // 対象、route 経由の整合は $slug.test.tsx 等で担保する。同型 (bq-merge.ts) と同じ exclude 方針。
  "apps/ryantsuji-dev/web/src/server/db.ts",
  "apps/ryantsuji-dev/web/src/server/auth-session.ts",
  "apps/ryantsuji-dev/web/src/server/engagement.ts",
  // .server.ts: client bundle 隔離のための薄い委譲ファイル。実体は engagement.ts /
  // auth-session.ts に。test は run* を直接呼ぶ ($slug.test.tsx 内) ので動作担保はある
  // が、coverage 計測は exclude (薄い wiring + 上記 module の delegation のみ)。
  "apps/ryantsuji-dev/web/src/routes/posts/$slug.server.ts",
  "apps/ryantsuji-dev/web/src/routes/series/$slug.server.ts",
  // CF Workers entry / startInstance: Worker runtime でのみ実行されるため node test
  // からは到達不可。env binding 経路の正しさは route 側 ($slug.test.tsx) が踏み、
  // 実 deploy は wrangler deploy --dry-run + 手動 smoke で検証する方針。
  "apps/ryantsuji-dev/web/src/server.ts",
  "apps/ryantsuji-dev/web/src/start.ts",
  // 中間 type 定義のみ (実行時ロジックなし)
  "apps/graph/product/src/migrate/common/types.ts",
  // CLI entry-point: process.argv / staged file 取得 / process.exit のみ。
  // 純粋ロジックは sibling lib で網羅テスト済み。
  "scripts/hooks/*.cli.ts",
  "scripts/*.cli.ts",
  // Pulumi の Pulumi.yaml / Pulumi.<stack>.yaml は code ではない
  "**/Pulumi.*.yaml",
  // TanStack Router 自動生成 routeTree (commit 済だが human-authored ではないので coverage 計測対象外)
  "**/routeTree.gen.ts",
  // vitest setup は test infrastructure (mock 定義) なので coverage 計測対象外。
  // pure logic を持つ場合は src/ に切り出してテスト対象にする。
  "**/test-setup.ts",
];

/**
 * per-file 90% 強制の threshold 値。vitest config の `coverage.thresholds` に流す。
 *
 * @graph-connects none
 */
export const COVERAGE_THRESHOLDS = {
  perFile: true,
  lines: 90,
  functions: 90,
  branches: 90,
  statements: 90,
} as const;

/**
 * glob ライクな pattern と file path の一致判定 (vitest / minimatch globstar 相当の
 * 最小実装)。
 *
 * 対応する syntax:
 *   - `/**\/` → zero 含む任意 path segment 列 (両端 `/` を吸収)
 *   - `/**` (末尾) → 残り全部 optional
 *   - `**\/` (先頭) → 先頭部分 optional
 *   - `**` (単独) → 任意 (segment 跨ぎ OK)
 *   - `*` → / を含まない任意文字列
 *   - `{a,b}` → グループ alternation
 *   - 他は literal (regex メタ文字は escape)
 *
 * @graph-connects none
 */
export function matchGlob(pattern: string, file: string): boolean {
  // 1. {a,b,c} → (?:a|b|c)。ネスト想定なし
  let p = pattern.replace(/\{([^}]+)\}/g, (_m, inner: string) => {
    return `(?:${inner.split(",").join("|")})`;
  });
  // 2. regex メタ文字 escape (`*` は後段で扱うため除外、`(`/`)`/`|`/`?`/`:` は
  //    alternation 展開で生成された側なので escape しない)
  p = p.replace(/\./g, "\\.").replace(/\+/g, "\\+").replace(/\^/g, "\\^").replace(/\$/g, "\\$");
  // 3. glob → regex 変換。`*` 系を順に sentinel string (pattern に現れない記号列) に
  //    逃がしてから一気に逆置換する。逆置換しないと前段の置換結果 (`.*` 内の `*`) を
  //    後段の `*` 置換が破壊してしまう。
  //
  //    /**\/ → §0§ → /(?:.*\/)?  (zero 含む path 列、両端 / 吸収)
  //    /**$  → §1§ → (?:/.*)?    (末尾 ** は残り optional)
  //    ^**\/ → §2§ → (?:.*/)?    (先頭 ** も同様)
  //    **    → §3§ → .*          (それ以外)
  //    *     → §4§ → [^/]*       (segment 内 only)
  p = p
    .replace(/\/\*\*\//g, "§0§")
    .replace(/\/\*\*$/g, "§1§")
    .replace(/^\*\*\//g, "§2§")
    .replace(/\*\*/g, "§3§")
    .replace(/\*/g, "§4§")
    .replace(/§0§/g, "/(?:.*/)?")
    .replace(/§1§/g, "(?:/.*)?")
    .replace(/§2§/g, "(?:.*/)?")
    .replace(/§3§/g, ".*")
    .replace(/§4§/g, "[^/]*");
  return new RegExp(`^${p}$`).test(file);
}

/**
 * 与えた file path が coverage 計測対象かどうか判定。
 *
 * - `COVERAGE_INCLUDE` のいずれかに match
 * - かつ `COVERAGE_EXCLUDE` のいずれにも match しない
 *
 * Test file (`*.test.ts`) や CLI entry (`*.cli.ts`) は exclude されて false を返す。
 *
 * @graph-connects none
 */
export function isCovered(file: string): boolean {
  const included = COVERAGE_INCLUDE.some((p) => matchGlob(p, file));
  if (!included) return false;
  const excluded = COVERAGE_EXCLUDE.some((p) => matchGlob(p, file));
  return !excluded;
}

/**
 * source file path に対応する test file の候補 path 一覧を返す。同階層の
 * `<basename>.test.<ts|tsx>` を試す。
 *
 * @graph-connects none
 */
export function candidateTestFiles(source: string): string[] {
  const tsxBase = source.replace(/\.tsx?$/, "");
  return [`${tsxBase}.test.ts`, `${tsxBase}.test.tsx`];
}
