/**
 * `/sitemap.xml` の本体生成。`urlset` (sitemaps.org schema) に `xhtml:link rel="alternate"`
 * (= multilingual sitemap extension) を組合せて、Google Search Console / 各種 search
 * engine に「en post と ja post は互いに翻訳関係にある別 page」と明示する。
 *
 * GSC が「重複しています。ユーザーにより、正規ページとして選択されていません」と
 * 警告したのは、ja post (`?lang=ja`) と en post (無印) が path 同一 + query 違いで
 * Google から「same page, parameter variant」に見えていたため。head `<link
 * rel="alternate" hreflang>` (= `routes/posts/$slug.tsx:buildPostLinks`) と
 * sitemap の `xhtml:link` 両方で reciprocal な hreflang を declare することで、
 * Google は別 page として両方 index する。
 *
 * 仕様:
 * - 1 post につき lang variant ごとに `<url>` entry を 1 つずつ emit (= Google 推奨の
 *   per-variant URL pattern)。各 entry に同じ alternate set を持たせる reciprocal 構成
 * - static URL (`/`, `/about`, `/posts`, `/privacy`, `/terms`) と series hub
 *   (`/series/<slug>`) は single canonical で、alternate set 無し
 * - `<lastmod>` は post の `updatedAt` (無ければ `publishedAt`) を `YYYY-MM-DD` 形式で
 *   入れる。Google は時刻付きでも日付のみでも accept する
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business `/sitemap.xml` の XML 本体を post / series / static 静的 URL 集約から組み立てる pure 関数。lang variant ごとに per-URL entry を emit し、xhtml:link alternate で hreflang reciprocal を declare、GSC の「重複 canonical」警告を解消する
 * @graph-connects content [reads_from] PostListItem の slug / availableLangs / updatedAt / publishedAt から URL と lastmod を組む
 */

import type { Lang } from "./i18n.js";
import type { PostListItem } from "./posts.js";

/**
 * XML escape (RSS と同 spec)。`<loc>` / `<lastmod>` は text node なので 3 文字、
 * 属性値 (`href="..."`) は 5 文字 escape する。両者で安全な superset として
 * `escapeXml` (rss.ts と同等) を別 file から copy せず本 module 内で完結する。
 *
 * @graph-connects none
 */
export function escapeSitemapXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * post slug + lang から canonical URL を組む。`routes/posts/$slug.tsx:postUrlFor`
 * と同 logic だが、server module 側の依存方向を「server → routes」にしない
 * (= 逆向きに 1 行 duplicate する) ことで、route file の bundle が server module
 * に逆流するのを防ぐ。両 helper は単純なので drift しにくい。
 *
 * @graph-connects none
 */
export function postCanonicalUrl(baseUrl: string, slug: string, lang: Lang): string {
  return `${baseUrl}/posts/${slug}${lang === "ja" ? "?lang=ja" : ""}`;
}

/**
 * 1 post の lang variant 1 つに対応する `<url>` entry を組む。`availableLangs` 全部
 * への alternate を載せる (reciprocal)。x-default は en があれば en に、無ければ
 * 単独 lang の URL に倒す。
 *
 * @graph-connects none
 */
export function buildPostUrlEntry(input: {
  baseUrl: string;
  slug: string;
  servedLang: Lang;
  availableLangs: ReadonlyArray<Lang>;
  lastmod: string;
}): string {
  const loc = postCanonicalUrl(input.baseUrl, input.slug, input.servedLang);
  const alternates: string[] = [];
  for (const l of input.availableLangs) {
    const href = postCanonicalUrl(input.baseUrl, input.slug, l);
    alternates.push(
      `    <xhtml:link rel="alternate" hreflang="${l}" href="${escapeSitemapXml(href)}"/>`,
    );
  }
  // x-default: en があれば en URL、無ければ「使える唯一の lang」の URL に倒す
  const xDefaultLang: Lang = input.availableLangs.includes("en")
    ? "en"
    : (input.availableLangs[0] ?? input.servedLang);
  const xDefault = postCanonicalUrl(input.baseUrl, input.slug, xDefaultLang);
  alternates.push(
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeSitemapXml(xDefault)}"/>`,
  );
  return [
    "  <url>",
    `    <loc>${escapeSitemapXml(loc)}</loc>`,
    `    <lastmod>${input.lastmod}</lastmod>`,
    ...alternates,
    "  </url>",
  ].join("\n");
}

/**
 * 静的 URL (alternate 無し、single canonical) の `<url>` entry を組む。`/`, `/about`,
 * `/posts` 等 lang-neutral な page 用。
 *
 * @graph-connects none
 */
export function buildStaticUrlEntry(input: { url: string; lastmod?: string }): string {
  const lines = ["  <url>", `    <loc>${escapeSitemapXml(input.url)}</loc>`];
  if (input.lastmod) lines.push(`    <lastmod>${input.lastmod}</lastmod>`);
  lines.push("  </url>");
  return lines.join("\n");
}

/**
 * post の最新更新日 (`YYYY-MM-DD`) を返す。`updatedAt` が `YYYY-MM-DD` で始まれば
 * その日付、無ければ `publishedAt` の日付を採用。`updatedAt` / `publishedAt` 両方とも
 * frontmatter で `YYYY-MM-DD` (or `YYYY-MM-DDTHH:...`) format 前提なので、先頭 10 字
 * を切るだけで十分。
 *
 * @graph-connects none
 */
export function postLastmod(post: PostListItem): string {
  return (post.updatedAt ?? post.publishedAt).slice(0, 10);
}

/**
 * sitemap.xml 全体を組み立てる pure 関数。`posts` (en list で取得した全 post)、
 * `seriesSlugs` (SERIES_REGISTRY のキー列)、`staticPaths` (lang 不変な page) を
 * 受け取り、urlset XML を返す。
 *
 * - posts は `availableLangs` を見て各 variant ごとに 1 entry ずつ emit。reciprocal
 *   な alternate set を全 entry に同一で載せる
 * - series / static は single canonical (lang-neutral) なので alternate 無し
 *
 * @graph-connects none
 */
export function buildSitemapXml(input: {
  baseUrl: string;
  posts: ReadonlyArray<PostListItem>;
  seriesSlugs: ReadonlyArray<string>;
  staticPaths: ReadonlyArray<string>;
  buildDate: string;
}): string {
  const urlEntries: string[] = [];

  // static (lang-neutral) entries
  for (const p of input.staticPaths) {
    urlEntries.push(buildStaticUrlEntry({ url: `${input.baseUrl}${p}`, lastmod: input.buildDate }));
  }

  // series hub entries (lang-neutral、URL に lang param 載らない)
  for (const slug of input.seriesSlugs) {
    urlEntries.push(
      buildStaticUrlEntry({ url: `${input.baseUrl}/series/${slug}`, lastmod: input.buildDate }),
    );
  }

  // post entries — variant ごとに 1 つずつ
  for (const post of input.posts) {
    const lastmod = postLastmod(post);
    for (const lang of post.availableLangs) {
      urlEntries.push(
        buildPostUrlEntry({
          baseUrl: input.baseUrl,
          slug: post.slug,
          servedLang: lang,
          availableLangs: post.availableLangs,
          lastmod,
        }),
      );
    }
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    '        xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...urlEntries,
    "</urlset>",
    "",
  ].join("\n");
}
