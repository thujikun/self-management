/**
 * `@self/syndication` — ryantsuji.dev の markdown source を Zenn / dev.to 向けに
 * 変換する pure pipeline。Phase 1 ではまず link rewriter のみ。footer append /
 * frontmatter builder / Zenn 独自記法 transformer / pipeline composer / CLI driver は
 * 後続 commit で順次追加する。実際の publish (dev.to API PUT / Zenn GitHub repo
 * push) は別 PR の CLI 層で実装。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 個人ブログ ryantsuji.dev の SoT markdown を、Zenn (JP) / dev.to (EN) syndication target 用に変換する純粋関数群。link rewriter / footer append / frontmatter 再構築 / Zenn 独自記法変換を独立した module として持ち、CLI / API publish 層から呼べる
 * @graph-connects content [reads_from] @self/content の Frontmatter type を入力として受ける
 */

export type { SyndicationTarget } from "./types.js";
export { rewriteInternalLinks } from "./link-rewriter.js";
export type { SlugResolver } from "./link-rewriter.js";
export { appendFooter } from "./footer.js";
export { buildZennFrontmatter, stringifyZennFrontmatter } from "./zenn-frontmatter.js";
export type { ZennFrontmatter, ZennBuildOptions } from "./zenn-frontmatter.js";
export { buildDevtoArticle } from "./devto-frontmatter.js";
export type { DevtoArticleAttributes, DevtoBuildOptions } from "./devto-frontmatter.js";
export { syndicateForZenn, syndicateForDevto } from "./pipeline.js";
export type { SyndicateForZennArgs, SyndicateForDevtoArgs } from "./pipeline.js";
