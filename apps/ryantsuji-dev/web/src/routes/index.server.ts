/**
 * `/` (landing) の **server-only** loader。
 *
 * 最新 3 件の post meta を取得して hero 下の "latest" section に並べる。
 * lang 解決は root loader が既に終えているので、ここは listPosts(lang) を呼ぶだけ。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business landing page の loader。最新 3 件の post meta を listPosts(lang) で取得し、hero 下の "latest" カードに流し込む。lang は cookie/Accept-Language ベースで root と整合
 * @graph-connects content [calls] listPosts(lang) で最新 post を取得
 */

import type { Lang } from "../server/i18n.js";
import { pickLang } from "../server/i18n.js";
import { listPosts, type PostListItem } from "../server/posts.js";
import { safeAcceptLanguage, safeCookieLang } from "../server/request.server.js";

/**
 * landing loader: 最新 3 件の post meta + 現在 lang を返す。
 *
 * @graph-connects content [calls] listPosts(lang)
 */
export function runLanding(options: { includeDrafts?: boolean } = {}): {
  lang: Lang;
  latest: PostListItem[];
} {
  const lang = pickLang({
    cookieLang: safeCookieLang(),
    acceptLanguage: safeAcceptLanguage(),
  });
  const latest = listPosts(lang, { includeDrafts: options.includeDrafts ?? false }).slice(0, 3);
  return { lang, latest };
}
