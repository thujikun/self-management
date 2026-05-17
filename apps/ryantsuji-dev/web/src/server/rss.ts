/**
 * Atom 1.0 feed の生成。`/rss/en.xml` / `/rss/ja.xml` に lang 別 feed を出す。
 *
 * 純粋関数 (`buildAtomFeed`) として post 配列 + lang + base URL を受け取り XML
 * 文字列を返すだけに留め、route ファイル (`routes/rss/$.ts`) 側で `listPosts` を
 * 呼んで配線する。これにより post 取得 (`virtual:rendered-posts` 仮想 module —
 * vite plugin が build 時に renderMarkdown 済 HTML を JSON で expose) と XML
 * 構築 (純粋文字列処理) を分離でき、テストが I/O なしで書ける。
 *
 * 仕様:
 * - Atom 1.0 (RFC 4287)。RSS 2.0 ではなく Atom を採用 (timezone / xml:lang /
 *   id 一意性の規定が明確で reader 互換性も同等以上)
 * - `xml:lang` を feed level に置き、entry の `<link rel="alternate">` には
 *   JP feed では `?lang=ja` を付ける (post 詳細 page の lang switch と整合)
 * - feed の `<updated>` は post の最大 publishedAt / updatedAt を採用 (post 0 件
 *   ならビルド時点の epoch 開始日 1970-01-01)
 * - cover image は `<media:thumbnail>` で出すと namespace 追加が必要なので v1 では
 *   含めない (将来必要なら namespace を追加)
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business RSS (Atom 1.0) feed XML を post meta から組み立てる pure 関数。lang 別 (EN/JP) に分離、entry URL は post 詳細 page と一致、XML escape を厳格に適用してハイジャック / 壊れ feed を防ぐ
 * @graph-connects content [reads_from] PostListItem の frontmatter から title/summary/publishedAt/updatedAt/tags を抜く
 */

import type { Lang } from "./i18n.js";
import type { PostListItem } from "./posts.js";

/**
 * XML テキストノード / 属性値で用いる予約文字を実体参照に。
 *
 * Atom の `<summary>` / `<title>` 等は text node なので `<`, `>`, `&` を escape、
 * 属性値 (例: `<entry><link href="..."/>`) は加えて `"` も escape する必要がある。
 * 両者で安全な superset として 5 文字すべて escape する。
 *
 * @graph-connects none
 */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * frontmatter の `publishedAt` / `updatedAt` (`YYYY-MM-DD` prefix) を RFC 3339 の
 * UTC 日時 (`YYYY-MM-DDT00:00:00Z`) に整形。Atom は `<published>` / `<updated>`
 * に RFC 3339 timestamp を要求するため、日付しか持たない post でも midnight UTC
 * を補って valid な feed にする。
 *
 * @graph-connects none
 */
export function toRfc3339(date: string): string {
  // `YYYY-MM-DD` prefix のみを取り、後ろの time portion (もし frontmatter に含まれて
  // いれば) は捨てる。midnight UTC で normalize して dst / tz の揺れを避ける。
  const ymd = date.slice(0, 10);
  return `${ymd}T00:00:00Z`;
}

/**
 * feed level の `<updated>` を決める: 全 post の `updatedAt` ?? `publishedAt` の
 * 最大値。post 0 件なら epoch 開始日 (`1970-01-01T00:00:00Z`) を返す (feed として
 * は valid だが reader 側で「古い」と判定されて当然)。
 *
 * @graph-connects none
 */
export function latestUpdatedAt(posts: PostListItem[]): string {
  if (posts.length === 0) return "1970-01-01T00:00:00Z";
  let max = "";
  for (const p of posts) {
    const ts = p.updatedAt ?? p.publishedAt;
    if (ts > max) max = ts;
  }
  return toRfc3339(max);
}

/** {@link buildAtomFeed} の引数。 */
export interface BuildAtomFeedArgs {
  /** `/posts` 一覧と同等の post array (publishedAt 降順を期待)。 */
  posts: PostListItem[];
  /** feed の対象言語。entry URL に `?lang=ja` を付けるかの判定に使う。 */
  lang: Lang;
  /** site の base URL (例: `https://ryantsuji.dev`)。trailing slash 無し。 */
  baseUrl: string;
}

/**
 * post 1 件分の `<entry>` を作る。link は post 詳細 page の URL に lang query を
 * 載せる (JP feed のみ `?lang=ja`、EN feed は default なので付けない)。
 *
 * @graph-connects none
 */
function buildEntry(post: PostListItem, lang: Lang, baseUrl: string): string {
  const url =
    lang === "ja" ? `${baseUrl}/posts/${post.slug}?lang=ja` : `${baseUrl}/posts/${post.slug}`;
  const published = toRfc3339(post.publishedAt);
  const updated = post.updatedAt ? toRfc3339(post.updatedAt) : published;
  const summaryEl = post.summary
    ? `    <summary type="text">${escapeXml(post.summary)}</summary>`
    : "";
  const categoryEls = post.tags.map((tag) => `    <category term="${escapeXml(tag)}"/>`).join("\n");
  const tagBlock = categoryEls ? `\n${categoryEls}` : "";

  return [
    "  <entry>",
    `    <id>${escapeXml(url)}</id>`,
    `    <title>${escapeXml(post.title)}</title>`,
    `    <link rel="alternate" type="text/html" href="${escapeXml(url)}"/>`,
    `    <published>${published}</published>`,
    `    <updated>${updated}</updated>`,
    summaryEl,
    tagBlock,
    "  </entry>",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/**
 * Atom 1.0 feed の XML 全体を組み立てる。
 *
 * @graph-connects none
 */
export function buildAtomFeed(args: BuildAtomFeedArgs): string {
  const { posts, lang, baseUrl } = args;
  const feedUrl = `${baseUrl}/rss/${lang}.xml`;
  const siteUrl = lang === "ja" ? `${baseUrl}/?lang=ja` : `${baseUrl}/`;
  const title =
    lang === "ja"
      ? "ryantsuji.dev — エンジニアリング / デザイン / プロダクト"
      : "ryantsuji.dev — engineering / design / product";
  const subtitle =
    lang === "ja" ? "辻 亮佑 (Ryan Tsuji) の個人ブログ" : "Ryan Tsuji's personal blog";
  const updated = latestUpdatedAt(posts);
  const entries = posts.map((p) => buildEntry(p, lang, baseUrl)).join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${lang}">`,
    `  <title>${escapeXml(title)}</title>`,
    `  <subtitle>${escapeXml(subtitle)}</subtitle>`,
    `  <id>${escapeXml(siteUrl)}</id>`,
    `  <link rel="self" type="application/atom+xml" href="${escapeXml(feedUrl)}"/>`,
    `  <link rel="alternate" type="text/html" href="${escapeXml(siteUrl)}"/>`,
    `  <updated>${updated}</updated>`,
    "  <author>",
    "    <name>Ryan Tsuji</name>",
    `    <uri>${escapeXml(baseUrl)}/</uri>`,
    "  </author>",
    entries,
    "</feed>",
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}
