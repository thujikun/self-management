---
title: "OGP 動作確認用 post"
publishedAt: "2026-05-18T16:25:00+09:00"
slug: "ogp-shakedown"
summary: "RSS 経由で Slack に流れた時に、サイト全体の og-image ではなく post 固有の cover image が unfurl されるかを確認するためのサイト内限定 post。"
tags:
  - "meta"
lang: "ja"
excludeFromSyndication: true
cover: /posts/ogp-shakedown.ja.cover.png
---

サイト全体共通の `og-image.png` ではなく、frontmatter の `cover` で指定した post 固有の画像が Slack の unfurl / X カードに乗るかを見るための置き post。

Zenn / dev.to には流さず、本サイトでのみ公開する。動作確認が終わったら md と cover image を一緒に削除する。
