# @self/design-tokens

ryantsuji.dev の design token SSoT。TypeScript を SSoT として、`tokens.css` (CSS variables) を build-time に派生させる。

## 設計方針

- **2 層構成**: primitive (`gray[500]`, `accent[600]`, `space[4]` 等) と semantic (`bg.surface`, `text.primary`, `glass.bg` 等)
- **OKLCH ベース**: 知覚均等な色空間。light/dark で同じ step が同じ perceived lightness になるよう調整
- **light / dark 統合**: site baseline は dark で、`prefers-color-scheme: light` で semantic だけ light に上書き (primitive は theme 不変)
- **fluid typography**: `clamp(min, vw-based, max)` で 1 set で mobile/desktop 両対応
- **glass morphism**: 半透明 bg + backdrop-filter blur + 低 alpha border の 3 値を semantic にまとめて提供
- **CSS variables 出力**: `pnpm build` で `dist/tokens.css` を生成、各 app は `import "@self/design-tokens/css"`

## カバーする token

| カテゴリ | primitive | semantic |
|---|---|---|
| color | `gray` (0/50/.../900/1000), `accent` (50/.../900) | `bg`, `text`, `border`, `accent`, `glass` |
| spacing | `space` (0/1/2/3/4/6/8/12/16/24, rem) | (semantic 化未定) |
| radius | `radius` (none/sm/md/lg/full) | (semantic 化未定) |
| typography | `fontFamily` (sans/serif/mono), `fontSize` (xs/sm/base/lg/xl/2xl/3xl, fluid clamp), `lineHeight`, `fontWeight` | (semantic 化未定) |
| motion | `duration` (instant/fast/base/slow), `easing` (linear/out/inOut/spring) | (semantic 化未定) |
| effect | `blur` (none/sm/md/lg/xl) | `glass.{bg,border,blur}` |

primitive を component から直接参照することは禁止していない (semantic 化されていない範囲はまず primitive を使う)。色だけは必ず semantic 経由。

## 使い方

### TypeScript から (型安全)

```ts
import { gray, accent, space, light, dark } from "@self/design-tokens";

// primitive (build-time に CSS var にも展開される、型安全に拾える)
const radius = space[4]; // "1rem"

// semantic (theme ごとに異なる値)
const bg = light.bg.surface; // light の値
```

### CSS から (CSS variables)

```css
@import "@self/design-tokens/css";

.card {
  background: var(--bg-surface);
  color: var(--text-primary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: var(--space-4);
}

/* glass morphism (sticky header / floating panel 用) */
.header {
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur));
  border-bottom: 1px solid var(--glass-border);
}

/* :root は dark がデフォルト。light は @media (prefers-color-scheme: light) で上書きされるので、component 側は何もしなくて良い */
```

## ファイル構成

- `src/primitive.ts` — raw token (color / space / radius / typography / motion / blur)
- `src/semantic.ts` — semantic mapping (`light` / `dark` の SemanticTokens を 1 ファイルで持つ)
- `src/css.ts` — primitive + semantic を CSS variables 文字列に直列化する pure function
- `src/index.ts` — barrel export
- `scripts/build-css.ts` — `dist/tokens.css` を吐く build CLI

## 値の出所と Phase 1

現在の値は実用デフォルト。Phase 1 (design discovery) で OKLCH chroma / hue / type scale を再調整する想定。値変更は `src/primitive.ts` の上書きで完結し、`tokens.css` は `pnpm build` で再生成される。

## 参考リファレンス (Phase 1 観察用)

- [vercel.com](https://vercel.com), [linear.app](https://linear.app), [resend.com](https://resend.com), [railway.com](https://railway.com)
- [tailscale.com](https://tailscale.com), [anthropic.com](https://anthropic.com), [planetscale.com](https://planetscale.com)
- 個人系: [paco.me](https://paco.me), [leerob.io](https://leerob.io), [delba.dev](https://delba.dev), [brittanychiang.com](https://brittanychiang.com)
