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
 * default fetcher (本番は `globalThis.fetch`、test では vi.spyOn で stub 可能)。
 *
 * @graph-connects none
 */
export function defaultFetcher(): FetchFn {
  return globalThis.fetch as unknown as FetchFn;
}

/**
 * URL に query string を組み立てる helper。空 query なら base URL を返す。
 *
 * @graph-connects none
 */
export function buildUrl(path: string, query: Record<string, string>): string {
  const url = `${X_API_BASE}${path}`;
  const qs = new URLSearchParams(query).toString();
  return qs ? `${url}?${qs}` : url;
}

/**
 * pagination_token をマージして query を生成。
 *
 * @graph-connects none
 */
export function mergePaginationToken(
  query: Record<string, string>,
  token: string | undefined,
): Record<string, string> {
  if (!token) return { ...query };
  return { ...query, pagination_token: token };
}

/**
 * Bearer Authorization header を組み立てる単純な helper。
 *
 * @graph-connects none
 */
export function bearerAuthHeader(bearer: string): string {
  return `Bearer ${bearer}`;
}

/**
 * GET `${X_API_BASE}${path}?...query` を OAuth1 で sign して叩く。
 *
 * @graph-connects x-api [reads_from] 任意の v2 endpoint
 */
export async function xFetch<T>(
  creds: XCreds,
  path: string,
  query: Record<string, string> = {},
  fetcher: FetchFn = defaultFetcher(),
): Promise<T> {
  const url = `${X_API_BASE}${path}`;
  const auth = buildOAuth1Header("GET", url, creds, query);
  const fullUrl = buildUrl(path, query);
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
 * cursor 付きの v2 endpoint を全 page なめて配列で返す。
 * `meta.next_token` が無くなったら終了 (max 件数で打切り可)。
 *
 * @graph-connects x-api [reads_from] cursor-paginated endpoints
 */
export async function xPaginate<T>(
  creds: XCreds,
  path: string,
  query: Record<string, string> = {},
  opts: { maxPages?: number; fetcher?: FetchFn } = {},
): Promise<XPage<T>[]> {
  const fetcher = opts.fetcher ?? defaultFetcher();
  const max = opts.maxPages ?? Infinity;
  const pages: XPage<T>[] = [];
  let token: string | undefined;
  while (pages.length < max) {
    const q = mergePaginationToken(query, token);
    const res = await xFetch<XPage<T>>(creds, path, q, fetcher);
    pages.push({ data: res.data ?? [], meta: res.meta, includes: res.includes });
    token = res.meta?.next_token;
    if (!token) break;
  }
  return pages;
}

/**
 * OAuth 2.0 user-context Bearer 認証で GET。bookmark / engagement endpoint で使う。
 *
 * @graph-connects x-api [reads_from] OAuth2 Bearer で v2 endpoint
 */
export async function xFetchBearer<T>(
  bearer: string,
  path: string,
  query: Record<string, string> = {},
  fetcher: FetchFn = defaultFetcher(),
): Promise<T> {
  const fullUrl = buildUrl(path, query);
  const res = await fetcher(fullUrl, {
    headers: { Authorization: bearerAuthHeader(bearer) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`X API ${res.status} ${path}: ${body.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

/**
 * OAuth2 Bearer 版の cursor pagination (配列返し)。
 *
 * @graph-connects x-api [reads_from] OAuth2 Bearer で paginate
 */
export async function xPaginateBearer<T>(
  bearer: string,
  path: string,
  query: Record<string, string> = {},
  opts: { maxPages?: number; fetcher?: FetchFn } = {},
): Promise<XPage<T>[]> {
  const fetcher = opts.fetcher ?? defaultFetcher();
  const max = opts.maxPages ?? Infinity;
  const pages: XPage<T>[] = [];
  let token: string | undefined;
  while (pages.length < max) {
    const q = mergePaginationToken(query, token);
    const res = await xFetchBearer<XPage<T>>(bearer, path, q, fetcher);
    pages.push({ data: res.data ?? [], meta: res.meta, includes: res.includes });
    token = res.meta?.next_token;
    if (!token) break;
  }
  return pages;
}

