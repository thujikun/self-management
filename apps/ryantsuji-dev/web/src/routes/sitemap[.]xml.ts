/**
 * `/sitemap.xml` server route — Google Search Console / 各種 crawler 向け sitemap。
 *
 * 純 XML 構築は `server/sitemap.ts:buildSitemapXml` に切り出し済で、ここは「post /
 * series 取得 → buildSitemapXml に流す → Response 整形」の薄い glue。RSS と同
 * pattern (`routes/rss/$.ts`)。
 *
 * ファイル名の `[.]` は TanStack file-based routing の literal `.` escape (= path
 * を `/sitemap.xml` にする)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business `/sitemap.xml` を返す server route。post (en で listPosts) と series registry + 静的 URL を集めて buildSitemapXml に渡し、application/xml で返す。Google が ja/en 両 variant を別 page として index できるよう hreflang reciprocal を載せる
 * @graph-connects content [calls] listPosts(en) で全 post を取得
 * @graph-connects content [reads_from] SERIES_REGISTRY の slug 一覧
 * @graph-connects content [calls] buildSitemapXml で XML を組み立て
 * @graph-connects tanstack-start [provides] /sitemap.xml server handler
 */

import { createFileRoute } from "@tanstack/react-router";

import { listPosts } from "../server/posts.js";
import { SERIES_REGISTRY } from "../server/series.js";
import { buildSitemapXml } from "../server/sitemap.js";

/**
 * 本番公開 URL。sitemap の `<loc>` / hreflang alternate に絶対 URL を埋めるため必須。
 * rss.ts / $slug.tsx と同 SITE_URL 値で揃える (3 ファイル間で drift しないこと前提、
 * Worker 1 つの canonical hostname は単一なので問題は出にくい)。
 *
 * @graph-connects none
 */
const SITE_URL = "https://ryantsuji.dev";

/**
 * lang-neutral な静的 page 一覧。`/posts` (index) を含めるが、`/sign-in` /
 * `/account` 等 auth 経路は noindex 相当なので除外。`/series` は registry を別途
 * iterate するため list に入れない (= 専用 entry で出る)。
 *
 * @graph-connects none
 */
const STATIC_PATHS: ReadonlyArray<string> = ["/", "/about", "/posts", "/privacy", "/terms"];

/**
 * sitemap response を組み立てる pure helper (`Date` だけ inject 可能にして test
 * での日付固定を許す)。`includeDrafts: false` 固定 — draft は public sitemap に
 * 露出させない。
 *
 * @graph-connects content [calls] listPosts + buildSitemapXml
 */
export function handleSitemapRequest(now: Date = new Date()): Response {
  const posts = listPosts("en");
  const seriesSlugs = Object.keys(SERIES_REGISTRY);
  const buildDate = now.toISOString().slice(0, 10);
  const xml = buildSitemapXml({
    baseUrl: SITE_URL,
    posts,
    seriesSlugs,
    staticPaths: STATIC_PATHS,
    buildDate,
  });
  return new Response(xml, {
    status: 200,
    headers: {
      // sitemaps.org は `application/xml` を推奨。`text/xml` でも crawler は受けるが
      // application/xml が canonical。
      "content-type": "application/xml; charset=utf-8",
      // edge で 1 時間キャッシュ。post 追加が反映されるまでの遅延より crawler 側の
      // re-fetch 頻度 (通常 24h+) の方が長いため、1h cache で問題ない。
      "cache-control": "public, max-age=3600, s-maxage=3600",
    },
  });
}

/** @graph-connects tanstack-start [provides] /sitemap.xml server route */
export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: () => handleSitemapRequest(),
    },
  },
});
