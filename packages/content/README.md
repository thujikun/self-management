# @self/content

ryantsuji.dev の markdown rendering pipeline。**server-only** (RSC で server bundle に閉じ込める前提)。

## 何をする

`renderMarkdown(source: string): Promise<RenderedDoc>` を 1 つ提供する。pipeline:

1. `gray-matter` で frontmatter / body 分離
2. Zod schema (`FrontmatterSchema`) で frontmatter validate + 既定値付与
3. `unified` + `remark-parse` + `remark-gfm` で markdown AST
4. `remark-rehype` で HTML AST に変換
5. `rehype-slug` で heading に id、`rehype-autolink-headings` で anchor link 付与
6. `@shikijs/rehype` で code block を syntax highlight (light/dark CSS variable 出し)
7. `rehype-stringify` で HTML 文字列化

戻り値:

```ts
interface RenderedDoc {
  frontmatter: Frontmatter;       // title / publishedAt / tags / canonical / draft / lang ...
  html: string;                   // shiki + autolink 適用済 HTML
  headings: Heading[];            // H2/H3 の TOC (id 付き)
  readingTimeMinutes: number;     // CJK = 字数/500、英数字 = 単語数/220 の max
}
```

## frontmatter schema (Zod)

```yaml
---
title: "私の投稿"            # 必須
publishedAt: "2026-05-08"     # 必須、YYYY-MM-DD prefix
updatedAt: "2026-05-09"       # 任意
slug: "custom-slug"           # 任意 (なければファイル名から導出する想定、呼び出し側責務)
summary: "短い要約"           # 任意、OG 用
tags: ["TypeScript", "rsc"]   # 重複削除 + lowercase + sort
canonical: "https://..."      # 任意、syndication で original URL を保証
draft: false                  # default false
lang: "ja"                    # "ja" | "en"、default "ja"
---
```

`parseFrontmatter(data: unknown): Frontmatter` も別途 export しているので、frontmatter を render 抜きで validate したい場面 (一覧 page の build-time index など) で使える。

## TOC 用 helper

`extractHeadings(body)` は本文から H2 / H3 を順序通り取り出して `Heading[]` を返す。`id` は **rehype-slug が内部で使う `github-slugger` を直接利用** して算出するので、`renderMarkdown` が出す HTML 側の `<h2 id="...">` と完全に一致する。日本語見出しは Unicode を保持、同名見出しの重複時は `foo` / `foo-1` / `foo-2` の suffix も rehype-slug と同じ規則で振る。

` ``` ` / `~~~` の code fence 内 `## fake` は heading として拾わない (異種 delimiter で fence は閉じない、CommonMark 準拠)。

## 使い方 (RSC 経由想定)

```tsx
// route loader (server function 内、server bundle に閉じる)
import { createServerFn } from "@tanstack/react-start";
import { renderServerComponent } from "@tanstack/react-start/rsc";
import { renderMarkdown } from "@self/content";

const getPost = createServerFn().handler(async ({ data: { slug } }) => {
  const source = await readMarkdownFile(slug); // app 側の loader
  const doc = await renderMarkdown(source);
  const Renderable = await renderServerComponent(<PostBody html={doc.html} />);
  return { Renderable, frontmatter: doc.frontmatter, headings: doc.headings };
});
```

`PostBody` は `dangerouslySetInnerHTML` で `html` を流す server component。shiki が出す output は CSS variables (`--shiki-light` / `--shiki-dark`) ベースなので、styles.css 側で:

```css
pre.shiki { background: var(--shiki-light-bg); color: var(--shiki-light); }
@media (prefers-color-scheme: dark) {
  pre.shiki { background: var(--shiki-dark-bg); color: var(--shiki-dark); }
  pre.shiki span { color: var(--shiki-dark) !important; }
}
```

## なぜ server-only か

- `shiki` の grammar / theme は数百 KB ある。client bundle に乗せるとブログのコールドロード が悲惨に
- RSC で server に閉じれば bundle へ漏れない
- 静的サイト的に build-time に流すこともでき、cache 戦略を後で足しやすい

## 依存

すべて `pnpm-workspace.yaml` の catalog に登録 (workspace で同 version を保証):

| package | 役目 |
|---|---|
| `unified` | AST pipeline 駆動 |
| `remark-parse` / `remark-gfm` / `remark-rehype` | markdown → AST → HTML AST |
| `rehype-slug` / `rehype-autolink-headings` | heading id + anchor link |
| `rehype-stringify` | HTML AST → 文字列 |
| `@shikijs/rehype` / `shiki` | code highlight |
| `gray-matter` | frontmatter 分離 |
| `zod` | frontmatter schema |

## ファイル構成

- `src/frontmatter.ts` — Zod schema + `parseFrontmatter`
- `src/headings.ts` — `extractHeadings` / `slugify` / `estimateReadingTimeMinutes`
- `src/render.ts` — pipeline 本体 (`renderMarkdown`)
- `src/index.ts` — barrel export
