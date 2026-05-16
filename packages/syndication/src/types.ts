/**
 * syndication target の type alias と関連 type。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business syndication target を string literal union として持ち、各 transform 関数の引数 type を統一する。dev.to (EN) / Zenn (JP) の 2 系統のみ初期対応
 * @graph-connects none
 */

/** @graph-connects none */
export type SyndicationTarget = "zenn" | "devto";
