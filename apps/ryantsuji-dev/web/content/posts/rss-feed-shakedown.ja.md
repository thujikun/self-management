---
title: "RSS feed の動作確認用 post"
publishedAt: "2026-05-18"
slug: "rss-feed-shakedown"
summary: "ryantsuji.dev の RSS feed (Atom 1.0) が正しく生成されるか確認するための post。Zenn / dev.to には流さず、本サイトでのみ公開する。"
tags:
  - "meta"
lang: "ja"
excludeFromSyndication: true
---

このページは ryantsuji.dev の RSS feed が正しく動いているかを確認するための、サイト内限定の post です。

[`/rss/ja.xml`](/rss/ja.xml) を開くと Atom 1.0 形式の feed が返るはずで、その中にこの post の entry が含まれていれば期待通りに動いている、というだけの目的の置き post。

`excludeFromSyndication: true` を frontmatter に入れているので Zenn / dev.to には流れない。動作確認が終われば消す予定。
