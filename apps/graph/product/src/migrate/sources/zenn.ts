/**
 * Zenn 記事 ingester。`https://zenn.dev/api/articles?username=...` から記事一覧を
 * 取り、`/api/articles/{username}/{slug}` で本文を fetch して contents node に変換。
 *
 * - external_id: Zenn の article id (numeric)
 * - url: `https://zenn.dev{path}` (path は API response の絶対パス)
 * - body_md: 本文 markdown (個別 fetch、なければ title fallback)
 * - body_summary: title + emoji + 本文の冒頭 500 字程度 (embedding 入力)
 * - author_person_id: Ryan 本人 (SELF_PERSON_ID = deterministicId("person", "ryantsuji"))
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business 自分の Zenn 記事を contents table に backfill する parser。X URL share の seed として、また semantic search 対象として記事メタ + 本文 embedding を BQ に入れる
 * @graph-connects zenn-api [reads_from] /api/articles で記事一覧 + 本文を fetch
 * @graph-connects bigquery [writes_to] contents (source=zenn) + authored edges (Ryan → 記事)
 */

import { deterministicId } from "../common/id.js";
import type { EdgeInput, NodeInput, ParseResult } from "../common/types.js";
import { SELF_PERSON_ID } from "./threads.js";

/** @graph-connects none */
export const ZENN_API_BASE = "https://zenn.dev";

/**
 * 記事 path から Zenn 記事 URL を組み立てる helper。
 *
 * @graph-connects none
 */
export function buildZennUrl(path: string): string {
  return `${ZENN_API_BASE}${path}`;
}

/**
 * default username (Ryan の Zenn handle)。テスト容易性のため named function 化。
 *
 * @graph-connects none
 */
export function defaultZennUsername(): string {
  return "thujikun";
}

/**
 * emoji がある場合 "{emoji} {title}" を、無ければ title のみを返す。
 *
 * @graph-connects none
 */
export function emojiPrefixedTitle(article: ZennListArticle): string {
  return article.emoji ? `${article.emoji} ${article.title}` : article.title;
}

/**
 * 本文 markdown を 1 行化 (whitespace collapse + trim)。embedding 入力用。
 *
 * @graph-connects none
 */
export function trimBody(body: string): string {
  return body.replace(/\s+/g, " ").trim();
}

/** Zenn API list endpoint の article 要素 (使う field のみ)。 */
export interface ZennListArticle {
  id: number;
  title: string;
  slug: string;
  emoji?: string | null;
  article_type?: string | null;
  published_at: string;
  body_letters_count?: number;
  liked_count?: number;
  path: string;
}

/** `/api/articles/{username}/{slug}` の response 要素 (body 取得用)。 */
export interface ZennDetail {
  body_html?: string;
  body?: string;
  body_letters_count?: number;
}

/** fetcher inject 用 (test で network 回避)。 */
export type FetchFn = (url: string) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}>;

/**
 * default fetcher (本番は globalThis.fetch、test では引数で stub)。
 *
 * @graph-connects none
 */
export function defaultFetcher(): FetchFn {
  return globalThis.fetch as unknown as FetchFn;
}

/**
 * `/api/articles?username=...` を全 page なめて記事一覧を返す。
 *
 * @graph-connects zenn-api [reads_from] paginated list
 */
export async function fetchZennArticles(
  username: string,
  fetcher: FetchFn = defaultFetcher(),
): Promise<ZennListArticle[]> {
  const out: ZennListArticle[] = [];
  let page = 1;
  // Zenn の next_page は null になるか page=N でループするまで
  for (let i = 0; i < 50; i++) {
    const url = `${ZENN_API_BASE}/api/articles?username=${encodeURIComponent(username)}&order=latest&page=${page}`;
    const res = await fetcher(url);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Zenn list ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as { articles?: ZennListArticle[]; next_page?: number | null };
    for (const a of data.articles ?? []) out.push(a);
    if (!data.next_page) break;
    page = data.next_page;
  }
  return out;
}

/**
 * 個別記事の本文を取得 (markdown 優先、なければ html)。失敗時は空文字。
 *
 * @graph-connects zenn-api [reads_from] 単一記事
 */
export async function fetchZennBody(
  username: string,
  slug: string,
  fetcher: FetchFn = defaultFetcher(),
): Promise<string> {
  const url = `${ZENN_API_BASE}/api/articles/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`;
  const res = await fetcher(url);
  if (!res.ok) return "";
  const data = (await res.json()) as { article?: ZennDetail };
  const detail = data.article;
  if (!detail) return "";
  return detail.body ?? detail.body_html ?? "";
}

/**
 * Zenn 記事 1 件を NodeInput (contents) に変換。
 *
 * @graph-connects none
 */
export function zennArticleToNode(
  article: ZennListArticle,
  body: string,
  username: string,
): NodeInput {
  const id = deterministicId("zenn", String(article.id));
  const url = buildZennUrl(article.path);
  const titleWithEmoji = emojiPrefixedTitle(article);
  const bodyTrimmed = trimBody(body);
  const summary = `${titleWithEmoji}\n\n${bodyTrimmed.slice(0, 500)}`.trim();
  return {
    kind: "contents",
    id,
    fields: {
      content_id: id,
      source: "zenn",
      external_id: String(article.id),
      url,
      title: article.title,
      body_md: body,
      published_at: article.published_at,
      author_person_id: SELF_PERSON_ID,
    },
    body_summary: summary,
    metadata: {
      source: "zenn",
      slug: article.slug,
      emoji: article.emoji ?? null,
      article_type: article.article_type ?? null,
      liked_count: article.liked_count ?? null,
      body_letters_count: article.body_letters_count ?? null,
      author_handle: username,
    },
    first_seen_at: article.published_at,
  };
}

/**
 * Zenn の自分のアカウント全記事を取り込む parser entry。
 *
 * @graph-connects zenn-api [reads_from] 全記事 + 本文
 * @graph-connects bigquery [writes_to] contents + personal_edges (authored)
 */
export async function parseZenn(
  opts: { username?: string; fetcher?: FetchFn } = {},
): Promise<ParseResult> {
  const username = opts.username ?? defaultZennUsername();
  const fetcher = opts.fetcher;
  const articles = await fetchZennArticles(username, fetcher);
  const nodes: NodeInput[] = [];
  const edges: EdgeInput[] = [];
  for (const article of articles) {
    const body = await fetchZennBody(username, article.slug, fetcher);
    const node = zennArticleToNode(article, body, username);
    nodes.push(node);
    edges.push({
      edge_table: "personal_edges",
      edge_type: "authored",
      src_kind: "persons",
      src_id: SELF_PERSON_ID,
      tgt_kind: "contents",
      tgt_id: node.id,
      created_at: article.published_at,
    });
  }
  return { source: "zenn", nodes, edges };
}
