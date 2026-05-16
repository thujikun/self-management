/**
 * `@self/syndication` — ryantsuji.dev の markdown source を Zenn / dev.to 向けに
 * 変換する pure pipeline。Phase 1 では transform 関数群と pipeline composer のみ。
 * 実際の publish (dev.to API PUT / Zenn GitHub repo push) は別 PR の CLI 層で実装。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 個人ブログ ryantsuji.dev の SoT markdown を、Zenn (JP) / dev.to (EN) syndication target 用に変換する純粋関数群。link rewriter / footer append / frontmatter 再構築 / Zenn 独自記法変換を独立した module として持ち、CLI / API publish 層から呼べる
 * @graph-connects content [reads_from] @self/content の Frontmatter type を入力として受ける
 */

export type { SyndicationTarget } from "./types.js";
export { rewriteInternalLinks } from "./link-rewriter.js";
