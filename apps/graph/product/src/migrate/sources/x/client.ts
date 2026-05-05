/**
 * X API client (OAuth1-signed GET、async pagination)。
 *
 * - `xFetch`: 1 つの GET endpoint を OAuth1 で叩く。non-2xx は throw
 * - `xPaginate`: `meta.next_token` を辿って async generator で全 page を yield
 *
 * テスト容易性のため `fetch` は inject 可能。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business X API への OAuth1 GET ラッパーと cursor pagination iterator。fetch を inject 可能にして parser tests をネットワーク無しで回せるよう設計
 * @graph-connects x-api [reads_from] X API v2 への GET (OAuth1-signed)
 */

import { buildOAuth1Header, type XCreds } from "./auth.js";

/** @graph-connects none */
export const X_API_BASE = "https://api.x.com";

/** `xFetch` / `xPaginate` で inject する fetch のシグネチャ。 */
export type FetchFn = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}>;

/**
 * GET `${X_API_BASE}${path}?...query` を OAuth1 で sign して叩く。
 *
 * @graph-connects x-api [reads_from] 任意の v2 endpoint
 */
export async function xFetch<T>(
  creds: XCreds,
  path: string,
  query: Record<string, string> = {},
  fetcher: FetchFn = globalThis.fetch as unknown as FetchFn,
): Promise<T> {
  const url = `${X_API_BASE}${path}`;
  const auth = buildOAuth1Header("GET", url, creds, query);
  const qs = new URLSearchParams(query).toString();
  const fullUrl = qs ? `${url}?${qs}` : url;
  const res = await fetcher(fullUrl, { headers: { Authorization: auth } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`X API ${res.status} ${path}: ${body.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

/** ページ 1 つ分の payload。 */
export interface XPage<T> {
  data: T[];
  meta?: { next_token?: string; result_count?: number } & Record<string, unknown>;
  includes?: Record<string, unknown>;
}

/**
 * cursor 付きの v2 endpoint を全 page なめる async generator。
 * `meta.next_token` が無くなったら終了。
 *
 * @graph-connects x-api [reads_from] cursor-paginated endpoints
 */
export async function* xPaginate<T>(
  creds: XCreds,
  path: string,
  query: Record<string, string> = {},
  opts: { maxPages?: number; fetcher?: FetchFn } = {},
): AsyncGenerator<XPage<T>> {
  const fetcher = opts.fetcher ?? (globalThis.fetch as unknown as FetchFn);
  const max = opts.maxPages ?? Infinity;
  let token: string | undefined;
  let pages = 0;
  while (pages < max) {
    const q: Record<string, string> = { ...query };
    if (token) q.pagination_token = token;
    const res = await xFetch<XPage<T>>(creds, path, q, fetcher);
    yield { data: res.data ?? [], meta: res.meta, includes: res.includes };
    token = res.meta?.next_token;
    pages++;
    if (!token) break;
  }
}
