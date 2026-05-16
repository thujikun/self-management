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
import rehypeShikiFromHighlighter from "@shikijs/rehype/core";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { unified } from "unified";

// shiki の **fine-grained bundle** path から theme / lang を **静的 import** する。
// `import { getSingletonHighlighter } from "shiki"` を使うと vite が全 200+ 言語の
// grammar を dynamic import 候補として bundle に含めてしまい、Cloudflare Workers の
// 3 MiB gzip 上限を超過する (emacs-lisp 単独で 761 KiB を占有していた)。静的 import
// に切替えることで **本サイトで実使用する 18 言語** だけが bundle に含まれる構造に
// なる。
//
// 新言語を post で使い始めたら、ここに 1 行追加するだけで OK。逆に削れば bundle が
// 縮む — 言語追加 / 削除が bundle size に 1:1 で効く透明な構造。
import githubDark from "shiki/themes/github-dark.mjs";
import githubLight from "shiki/themes/github-light.mjs";
import langBash from "shiki/langs/bash.mjs";
import langCss from "shiki/langs/css.mjs";
import langDiff from "shiki/langs/diff.mjs";
import langGo from "shiki/langs/go.mjs";
import langHtml from "shiki/langs/html.mjs";
import langJavascript from "shiki/langs/javascript.mjs";
import langJson from "shiki/langs/json.mjs";
import langJsonc from "shiki/langs/jsonc.mjs";
import langJsx from "shiki/langs/jsx.mjs";
import langMarkdown from "shiki/langs/markdown.mjs";
import langPython from "shiki/langs/python.mjs";
import langRust from "shiki/langs/rust.mjs";
import langShellscript from "shiki/langs/shellscript.mjs";
import langSql from "shiki/langs/sql.mjs";
import langToml from "shiki/langs/toml.mjs";
import langTsx from "shiki/langs/tsx.mjs";
import langTypescript from "shiki/langs/typescript.mjs";
import langYaml from "shiki/langs/yaml.mjs";

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
  cssVariablePrefix: "--shiki-",
} as const;

/**
 * fine-grained bundle で静的 import した theme / lang を core highlighter に渡す。
 * 同 module 内で 1 度だけ作って singleton 化、renderMarkdown 呼び出し毎の cold start
 * を避ける。
 *
 * 言語追加: 本 file の import を 1 行追加 → 下の配列にも 1 行追加。これ以外の場所で
 * shiki の dynamic 機能を呼ばない (= vite tree-shake が効く構造を維持する)。
 *
 * @graph-connects shiki [calls] createHighlighterCore で静的 import 済 theme/lang を highlighter 化
 */
let _highlighter: HighlighterCore | null = null;
/** @graph-connects none */
async function getShikiHighlighter(): Promise<HighlighterCore> {
  if (_highlighter) return _highlighter;
  _highlighter = await createHighlighterCore({
    themes: [githubLight, githubDark],
    langs: [
      langBash,
      langCss,
      langDiff,
      langGo,
      langHtml,
      langJavascript,
      langJson,
      langJsonc,
      langJsx,
      langMarkdown,
      langPython,
      langRust,
      langShellscript,
      langSql,
      langToml,
      langTsx,
      langTypescript,
      langYaml,
    ],
    engine: createJavaScriptRegexEngine(),
  });
  return _highlighter;
}

/**
 * 1 つの markdown source 文字列を parse + render する。
 *
 * @graph-connects none
 */
export async function renderMarkdown(source: string): Promise<RenderedDoc> {
  const parsed = matter(source);
  const frontmatter = parseFrontmatter(parsed.data);
  const body = parsed.content;

  const highlighter = await getShikiHighlighter();
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(rehypeAutolinkHeadings, { behavior: "wrap" })
    .use(rehypeShikiFromHighlighter, highlighter, SHIKI_OPTIONS)
    .use(rehypeStringify)
    .process(body);

  return {
    frontmatter,
    html: String(file),
    headings: extractHeadings(body),
    readingTimeMinutes: estimateReadingTimeMinutes(body),
  };
}
