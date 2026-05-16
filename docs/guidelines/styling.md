# Styling — Design Tokens 必須

CSS / 装飾の値は **必ず `@self/design-tokens` の semantic CSS variable 経由** で書く。
ryantsuji-dev (個人ブログ) を含む全 UI コードに適用。`apps/ryantsuji-dev/web` 配下の
`styles.css` / 各 component の inline style / Tailwind 4 utility すべてで、
literal 値 (magic number) を直書きしないことを SSoT 化する目的。

## なぜ

- light / dark 切替・theme リブランド (色相変更等) を**1 箇所**で吸収する
- 「`44rem`」「`16rem`」のような同じ値が複数箇所に散らばり、リブランド時の
  drift / 漏れの温床になる
- semantic name (`bg.surface`, `accent.bg`, `space-6`) で文脈を保持できる
- Tailwind 4 の `@theme` が design-tokens を参照する設計で、`bg-accent` 等の
  utility が常に SSoT と一致する

## ルール

| カテゴリ | 必須 token | 例 |
|---|---|---|
| color | `var(--accent-bg)`, `var(--text-primary)`, `var(--glass-bg)` 等 | ❌ `color: #0abab5` → ✅ `color: var(--accent-bg)` |
| spacing | `var(--space-1)`〜`var(--space-24)` (Tailwind: `--spacing-1`〜) | ❌ `padding: 24px` → ✅ `padding: var(--space-6)` |
| radius | `var(--radius-sm/md/lg/full)` | ❌ `border-radius: 12px` → ✅ `var(--radius-lg)` |
| blur | `var(--blur-sm/md/lg/xl)` | ❌ `backdrop-filter: blur(16px)` → ✅ `blur(var(--glass-blur))` |
| font | `var(--font-family-sans/serif/mono)`, `var(--font-size-*)`, `var(--line-height-*)`, `var(--font-weight-*)` | hardcode 禁止 |
| motion | `var(--duration-*)`, `var(--easing-*)` | hardcode 禁止 |
| layout container | `var(--container-content)`, `var(--container-toc)` 等 (Tailwind: `max-w-content`) | ❌ `max-width: 44rem` → ✅ `var(--container-content)` |
| breakpoint | `--breakpoint-*` (Tailwind: `xl:` 等) | ❌ `@media (min-width: 1280px)` → ✅ `@media (min-width: 80rem)` (= var) |
| overlay / backdrop | `var(--color-overlay)` | ❌ `oklch(0% 0 0 / 0.7)` → ✅ `var(--color-overlay)` |

## Tailwind 4 と design-tokens の bridging

`apps/ryantsuji-dev/web/src/styles.css` の `@theme` block で
`@self/design-tokens` の CSS variable を Tailwind の utility namespace に流す。

```css
@import "tailwindcss";
@import "@self/design-tokens/css";

@theme {
  --color-accent: var(--accent-bg);     /* → bg-accent / text-accent utility */
  --spacing-6: var(--space-6);          /* → p-6, m-6, gap-6 utility */
  --container-content: 44rem;           /* → max-w-content utility */
  /* ... */
}
```

- 既存 design-tokens に該当 token が無い場合は、まず `@theme` block か
  `packages/design-tokens/src/primitive.ts` / `semantic.ts` に**追加**してから
  使う (`@theme` への追加で済む one-off も、命名を semantic name で揃える)
- semantic class (`.post-card`, `.lang-switcher` 等) は維持。class の内部実装は
  `@apply` で Tailwind utility を合成し、結果的に design-tokens を経由する

## 許容される literal 値

以下は token 化しない:

- **viewport units** (`100vh`, `95vw`, `60vmax`): viewport-relative な計算式に組み込む
  必要がある場合。例: lightbox の `max-width: 95vw`
- **特定の装飾値**: 数式中の固定オフセット (`clamp(180px, 36vw, 320px)` の min/max、
  `radial-gradient(closest-side, ..., transparent 70%)` の 70% など)
- **CSS 関数の構造的 literal**: `0`, `1`, `100%`, `auto`, `transparent` 等

これら以外の literal を入れる場合は、コメントで **なぜ token 化しないか** を明示する。

## レビュー観点

- 新規 CSS / 既存 CSS の修正で literal 値が増えていないか
- `@theme` に追加するべき値が個別 component 内で直書きされていないか
- color / spacing / radius / blur / font / motion / layout container / breakpoint /
  overlay の 9 カテゴリで「該当 token 不存在」「該当 token 不採用」が無いか

不採用が見つかった場合は **Major** で `REQUEST_CHANGES`。既存コードの token 化漏れを
新規 PR で見つけたら、PR 範囲内で該当箇所も合わせて token 化する。
