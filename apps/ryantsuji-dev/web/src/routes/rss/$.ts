/**
 * `/rss/$` catch-all server route — Atom feed を返す。
 *
 * 受理する path:
 * - `/rss/en.xml` → EN 投稿 feed (Atom 1.0、`xml:lang="en"`)
 * - `/rss/ja.xml` → JP 投稿 feed (Atom 1.0、`xml:lang="ja"`)
 *
 * 他の splat (例: `/rss/foo.xml`) は 404 を返す。
 *
 * file-based routing の path に `.` (拡張子) を直接書きにくいので、`/rss/$`
 * の catch-all で splat 値 (`en.xml` / `ja.xml`) を見て分岐する。
 *
 * 純粋な XML 構築 logic は `server/rss.ts:buildAtomFeed` に切り出し済で、
 * ここは「post 取得 → lang 判定 → Response 整形」の薄い glue。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business `/rss/<lang>.xml` を catch-all で受けて Atom 1.0 feed を返すサーバ route。post 取得 (listPosts) と XML 構築 (buildAtomFeed) の glue のみ持ち、未対応 lang の splat は 404
 * @graph-connects content [calls] listPosts(lang) で投稿一覧を取得
 * @graph-connects content [calls] buildAtomFeed で Atom XML を組み立てる
 * @graph-connects tanstack-start [provides] /rss/$ catch-all server handler
 */

import { createFileRoute } from "@tanstack/react-router";

import type { Lang } from "../../server/i18n.js";
import { listPosts } from "../../server/posts.js";
import { buildAtomFeed } from "../../server/rss.js";

/**
 * 本番公開 URL。Atom feed の `<id>` / `<link>` / entry URL に絶対 URL を埋めるため
 * に必須。reader は相対 path を resolve できない (RFC 4287 + 各 reader 実装の
 * 制約)。__root.tsx の SITE_URL と二重定義になるが、片方を変えるだけで feed が
 * 壊れる重要 constant なので、参照元を 1 つに集める cost より変更点を 1 file に
 * 閉じる方を取った。
 *
 * @graph-connects none
 */
const SITE_URL = "https://ryantsuji.dev";

/**
 * splat 値 (`en.xml` / `ja.xml`) を lang に解決する pure 関数。
 *
 * - `en.xml` → `"en"`
 * - `ja.xml` → `"ja"`
 * - その他 (e.g. `feed.xml` / 空 / 拡張子なし) → null (route 側で 404)
 *
 * @graph-connects none
 */
export function resolveFeedLang(splat: string | undefined): Lang | null {
  if (splat === "en.xml") return "en";
  if (splat === "ja.xml") return "ja";
  return null;
}

/**
 * GET handler。splat から lang を解決し、`listPosts(lang)` + `buildAtomFeed` で
 * Atom XML を組み立てて `application/atom+xml` で返す。
 *
 * Cache-Control: edge で 5 分キャッシュ (post 追加直後に reader が拾えないリスクと
 * 静的配信 cost のバランス、Cloudflare 側の cache をフル活用する)。
 *
 * @graph-connects content [calls] listPosts / buildAtomFeed
 */
export function handleRssRequest(splat: string | undefined): Response {
  const lang = resolveFeedLang(splat);
  if (!lang) {
    return new Response("Not Found", { status: 404 });
  }
  const posts = listPosts(lang);
  const xml = buildAtomFeed({ posts, lang, baseUrl: SITE_URL });
  return new Response(xml, {
    status: 200,
    headers: {
      "content-type": "application/atom+xml; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=300",
    },
  });
}

/**
 * URL pathname (`/rss/<splat>`) から splat 部分を抽出する pure 関数。
 * server handler は `request.url` から path を取って分割する。`params._splat` を
 * 信頼しない理由: TanStack Start v1.167 の server handler では `params` の型が
 * 安定せず、URL ベースで切る方が runtime / test とも素直に動く。
 *
 * @graph-connects none
 */
export function splatFromUrl(url: string): string | undefined {
  const pathname = new URL(url).pathname;
  const prefix = "/rss/";
  if (!pathname.startsWith(prefix)) return undefined;
  return pathname.slice(prefix.length);
}

/** @graph-connects tanstack-start [provides] /rss/$ catch-all server route */
export const Route = createFileRoute("/rss/$")({
  server: {
    handlers: {
      GET: ({ request }: { request: Request }) => handleRssRequest(splatFromUrl(request.url)),
    },
  },
});
