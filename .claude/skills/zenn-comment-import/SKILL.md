---
name: zenn-comment-import
description: >-
  dev.to 記事に付いた議論を Zenn のコメント欄へ手貼りする文面を作る。scripts/build-zenn-comment-paste.ts
  が著者名・dev.to プロフィール・原文リンク・via dev.to の定型を組み立て、本文だけ {{TRANSLATE:...}}
  で囲んで .zenn-paste/<key>.md に出すので、それを自然な日本語に訳してから --render で HTML
  ダッシュボード (記事単位に並ぶ / コピーボタン / 完了チェック) を作る。ユーザーが「Zenn のコメント欄に
  dev.to の議論を貼りたい / 取り込みたい」「Zenn 用のコメント文面を作って」等と言ったら使う。
---

# Zenn コメント取り込み (dev.to → Zenn 手貼り文面生成)

## これは何か

Zenn には書き込み API が無く、コメントは手動投稿しかできない。dev.to の英語記事に付いた良い議論を
Zenn のコメント欄にも載せるため、**定型部分 (著者名 / プロフィール / 原文リンク / via dev.to) は
スクリプトが機械的に組み立て、本文の翻訳だけを AI が担う** 分業でやる。

- ryantsuji.dev 側は `scripts/import-devto-comments.ts` が **原文ママ** で Postgres へ自動 upsert 済み。
- Zenn 側はこの skill で **日本語に翻訳** して手貼りする (JP 読者向けなので訳す)。
- 選別ルールは両者共通: **本人 (ryantsuji) が返信したスレッドだけ**、本人の返信も含める。
- 貼り付け単位は **1 dev.to コメント = 1 Zenn コメント (メッセージ単位)**。スレッドを 1 通にまとめると
  読みづらく、コメントが付くたびにリアルタイムで貼りたいので、発言 1 件ずつを独立したカードにする。
- 生成物は `.zenn-paste/` (gitignore 済み) に出る。

## 手順

### 1. scaffold を生成する

ユーザーが記事を指定していなければ、どの記事か聞く (slug でも dev.to article id でもよい)。

```bash
pnpm tsx scripts/build-zenn-comment-paste.ts <slug>       # content の <slug>.en.md の devto id から
pnpm tsx scripts/build-zenn-comment-paste.ts --a-id <id>  # dev.to article id を直接指定
```

`.zenn-paste/<key>.md` が出る。本文は `{{TRANSLATE:` と `}}` で囲まれている。定型部分 (著者名リンク・
`（[原文](…)）`・via dev.to ヘッダ) は組み立て済み。複数記事を貼りたければ記事ごとに繰り返す
(それぞれ別の `.md` になる)。

### 2. `{{TRANSLATE:...}}` を日本語訳に置換する

各 `.zenn-paste/<key>.md` を開き、`{{TRANSLATE: <英語本文> }}` を **自然な日本語訳に置き換える**。
マーカー (`{{TRANSLATE:` / `}}`) 自体は消す。定型部分は **一切変えない**。

翻訳の方針:

- **意味を削らない**。要約ではなく翻訳。技術的なニュアンス (脅威モデルの議論など) を保つ。
- 相手のコメントも自分の返信も両方訳す。自分の返信は元が自分の英語なので、日本語として自然なら
  多少意訳してよい (最終的にユーザーが自分の声で直せるよう、忠実訳をベースにする)。
- 固有名詞・識別子・OSS 用語 (HMAC / prompt injection / Pulumi 等) は原語のまま。
- **JP 記事の表記ルールに従う** (`.claude/rules/ai-generated/project-context.md` の External Publication
  Guidelines):
  - 日本語と英数字の間にスペースを入れない (`HMACは` であって `HMAC は` ではない)。
  - ルー語を避ける (自然な日本語訳がある英語ビジネス用語は訳す)。
  - `**bold**` と日本語/日本語約物が隣接する場合のレンダリング注意 (同ガイドライン参照)。

### 3. HTML ダッシュボードに render する

```bash
pnpm tsx scripts/build-zenn-comment-paste.ts --render
```

`.zenn-paste/*.md` を全部読んで `.zenn-paste/index.html` を生成する。**記事単位でコメントが並び**、
各コメントに「📋 コピー」ボタンと「完了」チェック (localStorage 永続) が付く。まだ `{{TRANSLATE:...}}`
が残っていると「⚠ 未翻訳」と表示され、render 後の stdout にも未翻訳件数が出る。

### 4. ユーザーに渡す

`.zenn-paste/index.html` のパスを伝える。使い方: ブラウザで開き、各コメントの「コピー」で markdown を
クリップボードへ → Zenn のコメント欄に貼り付け → 貼り終えたら「完了」にチェック (進捗はブラウザに残る)。

## 注意

- **翻訳以外の改変をしない**。リンク・著者名・原文への導線・via dev.to は attribution なので保持する。
- スクリプトが「本人が絡んだスレッドがありません」と出したら、貼り付け対象なし。無理に作らない。
- render 前に `{{TRANSLATE:...}}` を訳し忘れていないか確認する (未翻訳は HTML で警告表示されるが、
  translate してから render するのが基本)。
- 貼り付ける文面は **markdown** (Zenn のコメント欄は markdown を解釈する)。Zenn 記法 (`:::message` 等) は不要。
- `.zenn-paste/` は gitignore 済み。commit しない。
