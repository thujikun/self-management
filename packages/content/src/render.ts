/**
 * markdown source 全体を parse → HTML 文字列に変換する pipeline。
 *
 * pipeline:
 * 1. `gray-matter` で frontmatter / body 分離
 * 2. `unified` + `remark-parse` + `remark-gfm` で markdown AST
 * 3. `remark-rehype` で HTML AST に変換、`rehype-slug` で heading id 付与
 * 4. `rehype-autolink-headings` で各見出しに anchor link
 * 5. `@shikijs/rehype` で code block を syntax highlight
 * 6. `rehype-stringify` で HTML 文字列に shrink
 *
 * RSC 経由で server-only に bundle される前提 (shiki は client に乗せない)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business markdown を server-only で HTML に変換する pipeline 本体。frontmatter 抽出 + remark + rehype + shiki を 1 関数にまとめ、render result は `{ frontmatter, html, headings, readingTime }` の structured object
 * @graph-connects shiki [calls] @shikijs/rehype 経由で code block の token をテーマ付き HTML に変換
 * @graph-connects unified [calls] remark-parse → remark-rehype → rehype-stringify の AST pipeline を構成
 */

import matter from "gray-matter";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeShiki from "@shikijs/rehype";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

import { parseFrontmatter, type Frontmatter } from "./frontmatter.js";
import { estimateReadingTimeMinutes, extractHeadings, type Heading } from "./headings.js";

/**
 * `renderMarkdown` の戻り値。view 側はこの 1 object を受け取って描画する。
 *
 * @graph-connects none
 */
export interface RenderedDoc {
  frontmatter: Frontmatter;
  html: string;
  headings: Heading[];
  readingTimeMinutes: number;
}

/**
 * shiki 用 rehype option。
 *
 * theme は light/dark 両方を渡し、shiki が `data-light` / `data-dark` 属性付きの
 * twoslash 風 markup を吐く。CSS 側で `prefers-color-scheme` で切替える pattern。
 *
 * @graph-connects none
 */
const SHIKI_OPTIONS = {
  themes: {
    light: "github-light",
    dark: "github-dark",
  },
  defaultColor: false,
  inline: undefined,
  cssVariablePrefix: "--shiki-",
} as const;

/**
 * 1 つの markdown source 文字列を parse + render する。
 *
 * @graph-connects none
 */
export async function renderMarkdown(source: string): Promise<RenderedDoc> {
  const parsed = matter(source);
  const frontmatter = parseFrontmatter(parsed.data);
  const body = parsed.content;

  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(rehypeAutolinkHeadings, { behavior: "wrap" })
    .use(rehypeShiki, SHIKI_OPTIONS)
    .use(rehypeStringify)
    .process(body);

  return {
    frontmatter,
    html: String(file),
    headings: extractHeadings(body),
    readingTimeMinutes: estimateReadingTimeMinutes(body),
  };
}
