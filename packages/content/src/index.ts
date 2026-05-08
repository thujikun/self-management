/**
 * `@self/content` — markdown rendering pipeline (server-only)。
 *
 * frontmatter Zod schema + GFM + shiki highlighting を 1 つの async 関数
 * `renderMarkdown(source)` で吐く。RSC (`createServerFn` の handler 内) から
 * 呼ぶ前提で、shiki / unified / remark-* は client bundle に乗せない。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business content rendering 公開 API の barrel。`renderMarkdown` 1 つで markdown source → 構造化された `RenderedDoc` を返す。Zod schema (`FrontmatterSchema`) と TOC 抽出 helper も export して route loader 側で参照可能
 * @graph-connects none
 */

export { FrontmatterSchema, parseFrontmatter } from "./frontmatter.js";
export type { Frontmatter } from "./frontmatter.js";

export { extractHeadings, slugify, estimateReadingTimeMinutes } from "./headings.js";
export type { Heading } from "./headings.js";

export { renderMarkdown } from "./render.js";
export type { RenderedDoc } from "./render.js";
