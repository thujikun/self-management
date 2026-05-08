# @self/design-tokens

ryantsuji.dev の design token SSoT (現状 stub)。

## 設計方針 (Phase 1 で実装)

- **2 層構成**: primitive token (`color.gray.50` 等) + semantic token (`bg.surface`, `text.primary` 等)
- **OKLCH ベース**: 知覚均等な色空間で primitive を定義、semantic で alias
- **light / dark 統合**: `prefers-color-scheme` で semantic 値だけ切替 (component 側は semantic しか触らない)
- **fluid typography**: `clamp()` ベースの type scale (1 set で mobile / desktop 両対応)
- **CSS variables 出力**: `src/tokens.css` を build して各 app から import

## 参考リファレンス

Phase 1 design discovery で観察するサイト:

- [vercel.com](https://vercel.com), [linear.app](https://linear.app), [resend.com](https://resend.com), [railway.com](https://railway.com)
- [tailscale.com](https://tailscale.com), [anthropic.com](https://anthropic.com), [planetscale.com](https://planetscale.com)
- 個人系: [paco.me](https://paco.me), [leerob.io](https://leerob.io), [delba.dev](https://delba.dev), [brittanychiang.com](https://brittanychiang.com)
