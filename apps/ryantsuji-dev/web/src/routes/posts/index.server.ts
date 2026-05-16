/**
 * `/posts` の **server-only** ロジック (Accept-Language header の読み出し)。
 *
 * `@tanstack/react-start/server` の `getRequestHeaders` は client bundle に乗ると
 * vite の import-protection plugin に弾かれるため `.server.ts` に隔離する。
 * 同じ pattern を `$slug.server.ts` でも採っている。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business /posts の loader 実体。Accept-Language を読み取り、override (?lang=) を最優先で受けて lang を決定、その lang variant の post 一覧を返す。server-only import (getRequestHeaders) を route 本体から隔離する目的で .server.ts に置く
 * @graph-connects tanstack-start [calls] getRequestHeaders で Accept-Language を読む
 * @graph-connects content [calls] listPosts(lang) で variant 解決済の一覧を取る
 */

import { getRequestHeaders } from "@tanstack/react-start/server";

import { pickLang, type Lang } from "../../server/i18n.js";
import { listPosts, type PostListItem } from "../../server/posts.js";

/**
 * /posts loader 本体。override (?lang= query) と Accept-Language から lang を決定し、
 * 当該 lang variant の post meta 一覧を返す。
 *
 * @graph-connects content [calls] listPosts(lang)
 */
/**
 * getRequestHeaders は server runtime 外 (= AsyncLocalStorage に StartEvent が無い場
 * 合、e.g. vitest 環境) で throw する。test では Accept-Language を取らない前提で
 * `null` を返し、`pickLang` 側で en fallback に倒す。
 *
 * @graph-connects none
 */
function safeAcceptLanguage(): string | null {
  try {
    const headers = getRequestHeaders() as unknown as Record<string, string | undefined>;
    return headers["accept-language"] ?? null;
  } catch {
    return null;
  }
}

/** @graph-connects content [calls] listPosts(lang) で variant 解決済の一覧を取る */
export function runListPosts(override: Lang | undefined): {
  lang: Lang;
  posts: PostListItem[];
} {
  const lang = pickLang(safeAcceptLanguage(), override);
  return { lang, posts: listPosts(lang) };
}
