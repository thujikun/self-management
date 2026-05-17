---
title: "[test] Zenn GitHub sync 連携テスト"
publishedAt: "2026-01-01"
slug: "_zenn-sync-test"
draft: true
lang: "ja"
summary: "Zenn GitHub 連携の sync 経路テスト。本記事は ryantsuji.dev / RSS には一切露出しない (_ prefix + draft: true)。Zenn 側に下書きとして同期されることを確認する目的のみ。"
tags:
  - "test"
syndication:
  zenn:
    id: "zenn-sync-test"
---

これは Zenn GitHub 連携の sync 経路をテストするための記事です。

- `_` prefix slug なので ryantsuji.dev の `/posts` 一覧・RSS に出ない
- `draft: true` なので `getRenderedPost` も null を返す (= URL 直叩きでも 404)
- syndicate CLI に `--include-drafts` を渡すと **Zenn にだけ** push される
- Zenn 側は frontmatter の `published: !meta.draft` 評価で `published: false` = 下書きとして同期される

以下はリンク書き換えテスト。本サイトの他記事への内部 link が Zenn の article URL に書き換わるかも一緒に検証する。

参考: [Agentic Graph RAG MCP](/posts/agentic-graph-rag-mcp)、[Sandbox MCP](/posts/sandbox-mcp)。

検証完了後はこの記事自体を削除する想定。
