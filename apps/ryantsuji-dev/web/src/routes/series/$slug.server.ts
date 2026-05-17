/**
 * `/series/$slug` の **server-only** loader。
 *
 * Accept-Language / cookie / ?lang= から lang を決定し、`listSeriesPosts` で
 * 当該 series の所属 post を `seriesOrder` 昇順で取得して返す。`/posts` index と
 * 同じ lang 決定経路を共有する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 連載 hub /series/$slug の loader 実体。pickLang で lang を決定 → listSeriesPosts(series slug, lang) で seriesOrder 順に並ぶ post 一覧を返す
 * @graph-connects content [calls] getSeriesMeta / listSeriesPosts
 */

import { pickLang, type Lang } from "../../server/i18n.js";
import { getSeriesMeta, listSeriesPosts, type SeriesMeta } from "../../server/series.js";
import type { PostListItem } from "../../server/posts.js";
import {
  safeAcceptLanguage,
  safeCookieLang,
  writeLangCookie,
} from "../../server/request.server.js";

/**
 * /series/$slug loader 本体。`meta=null` を返した場合は 404 を render する。
 *
 * @graph-connects content [calls] listSeriesPosts(seriesSlug, lang)
 */
export function runListSeriesPosts(
  seriesSlug: string,
  override: Lang | undefined,
): {
  lang: Lang;
  meta: SeriesMeta | null;
  posts: PostListItem[];
} {
  const cookieLang = safeCookieLang();
  const lang = pickLang({
    override,
    cookieLang,
    acceptLanguage: safeAcceptLanguage(),
  });
  if (override && override !== cookieLang) {
    writeLangCookie(lang);
  }
  const meta = getSeriesMeta(seriesSlug);
  if (!meta) {
    return { lang, meta: null, posts: [] };
  }
  return { lang, meta, posts: listSeriesPosts(seriesSlug, lang) };
}
