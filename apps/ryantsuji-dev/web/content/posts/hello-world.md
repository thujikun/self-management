---
title: "Hello, ryantsuji.dev"
publishedAt: "2026-05-08"
slug: "hello-world"
summary: "新しい個人サイト ryantsuji.dev を立ち上げた。スタックの選定理由と、ここで書いていきたいこと。"
tags:
  - meta
  - personal
lang: "ja"
---

## ようこそ

**ryantsuji.dev** は私 (Ryan Tsuji) の個人サイトです。エンジニアリング、デザイン、プロダクトの境界で考えていることを書き留める場所として運用しています。

## このサイトの構成

- **TanStack Start** + React Server Components で server-only に重い依存 (shiki / unified) を閉じ込め、client bundle を軽量に保つ
- **Cloudflare Workers** に generic SSR bundle を deploy
- **OKLCH ベースの design tokens** で light / dark を `prefers-color-scheme` で切替
- **マークダウン source** を SSoT、Zenn (JP) と dev.to (EN) には syndicate する形

## なぜ自前で持つか

書いた文章は **自分の URL の元に蓄積** したい。プラットフォームが消えても、自分のドメインは生き続けます。同時に、Zenn や dev.to には読者層がいるので、`canonical` を自サイトに向ける形で multi-channel に出していきます。

```ts
// canonical を maintain した frontmatter (本サイトの SSoT)
---
title: "..."
publishedAt: "2026-05-08"
canonical: "https://ryantsuji.dev/posts/hello-world"
---
```

## 書いていきたいこと

- 個人 / 業務で扱っている AI infra 設計
- TypeScript の型を「仕組みで守る」運用
- design system / OKLCH / token 駆動 UI
- AI agent + git workspace の組み合わせ

これからよろしくお願いします。
