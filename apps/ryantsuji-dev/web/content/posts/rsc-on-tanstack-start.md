---
title: "RSC on TanStack Start"
publishedAt: "2026-05-08"
slug: "rsc-on-tanstack-start"
summary: "TanStack Start v1.167 で React Server Components を有効化し、shiki などの重い依存を server bundle に閉じ込めた話。"
tags:
  - tanstack
  - rsc
  - vite
  - react
lang: "ja"
---

## 何をやったか

ryantsuji.dev で `tanstackStart({ rsc: { enabled: true } })` + `@vitejs/plugin-rsc` を組み、route loader 内で `renderServerComponent(<Body />)` を呼ぶ形にした。これで:

- markdown を server-only で HTML 化する pipeline (`@self/content`) が **client bundle に乗らない**
- shiki の WASM / grammar / theme 一式は rsc env のみに bundle される

## build の構造

vite が 5 environment を吐く:

| environment | 役割 |
|---|---|
| api | route 内 API handler |
| middleware | TanStack Start middleware |
| **rsc** | server component を React Flight stream に emit |
| client | hydration + flight stream consumer |
| ssr | initial HTML render |

## 検証

`Body` server component に shiki 結果を渡し、production build 後に grep。`dist/server/rsc/` 以下にだけ shiki token が現れて、`dist/client/` には漏れていないことを確認した。

```bash
$ grep -l "shiki" dist/**/*.js
dist/server/rsc/index.js  # rsc env のみ
```

## 制約

- `renderServerComponent` の引数は server で resolve する。client から prop を流すには `createServerFn().validator(...).handler(({data}) => ...)` の data 経由で serializable 値だけ渡す
- `React.Children.map()` は server 側で動かない。slot を作りたいなら `createCompositeComponent` を別途使う

詳細な spike record は `docs/spike/rsc.md` 参照。
