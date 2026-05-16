/**
 * `/posts` の **server-only** ロジック (Accept-Language header の読み出し)。
 *
 * 実 header 取得は `server/request.server.ts:safeAcceptLanguage` に集約済。本 file は
 * `@tanstack/react-start/server` を直接 import しないが、その helper を経由するため
 * client bundle 隔離の対称性として `.server.ts` 命名を維持する (`$slug.server.ts`
 * と同じ pattern)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business /posts の loader 実体。override (?lang=) を最優先で受け、無ければ safeAcceptLanguage 経由で Accept-Language を読んで lang を決定、その lang variant の post 一覧を返す。Accept-Language 取得は server/request.server.ts に集約
 * @graph-connects content [calls] listPosts(lang) で variant 解決済の一覧を取る
 */

import { pickLang, type Lang } from "../../server/i18n.js";
import { listPosts, type PostListItem } from "../../server/posts.js";
import { safeAcceptLanguage } from "../../server/request.server.js";

/**
 * /posts loader 本体。override (?lang= query) と Accept-Language から lang を決定し、
 * 当該 lang variant の post meta 一覧を返す。
 *
 * @graph-connects content [calls] listPosts(lang)
 */
/** @graph-connects content [calls] listPosts(lang) で variant 解決済の一覧を取る */
export function runListPosts(override: Lang | undefined): {
  lang: Lang;
  posts: PostListItem[];
} {
  const lang = pickLang(safeAcceptLanguage(), override);
  return { lang, posts: listPosts(lang) };
}
