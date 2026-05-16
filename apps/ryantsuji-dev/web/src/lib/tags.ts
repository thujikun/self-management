/**
 * tag 表示・filter の共通 util。
 *
 * dev.to / Zenn に向けて syndicate する時に必要だが、ryantsuji.dev 上では出したく
 * ない tag (例: `webdev` は dev.to の chronological feed に乗せる目的でしか付けて
 * いない) を `SYNDICATION_ONLY_TAGS` に列挙する。`displayTags(tags)` でこれを
 * filter した list を返す。
 *
 * frontmatter 自体には残す方針 (将来の syndicator がそのまま読めるように)。表示
 * 層だけで隠す。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 投稿 tag の表示 filter。syndication-only tag (e.g. dev.to の `webdev`) は ryantsuji.dev 上で見せず、frontmatter には残して将来の syndicator が再利用できるようにする
 * @graph-connects none
 */

/** @graph-connects none */
export const SYNDICATION_ONLY_TAGS: ReadonlySet<string> = new Set([
  // dev.to の chronological feed (ホーム露出) に乗せるためだけの broad tag。
  // ryantsuji.dev 上では noise になるので隠す。
  "webdev",
  // dev.to の "show & tell" 露出枠。Same pattern。
  "showdev",
]);

/**
 * 表示用 tag list (syndication-only を除外、入力順保持)。
 *
 * @graph-connects none
 */
export function displayTags(tags: readonly string[]): string[] {
  return tags.filter((t) => !SYNDICATION_ONLY_TAGS.has(t));
}
