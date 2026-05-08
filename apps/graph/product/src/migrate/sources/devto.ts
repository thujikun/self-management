/**
 * dev.to 記事 ingester。`https://dev.to/api/articles?username=...` から記事一覧を
 * 取り、`/api/articles/{id}` で本文を fetch して contents node に変換。
 *
 * - external_id: dev.to の article id (numeric)
 * - url: response の `url` (絶対 URL)
 * - body_md: detail endpoint の `body_markdown` (なければ description fallback)
 * - body_summary: title + description + 本文冒頭 (embedding 入力)
 * - metadata.tags: list の `tag_list` (topic edge の seed として後で使う)
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business 自分の dev.to 記事を contents table に backfill する parser。X URL share の seed として、また semantic search 対象として記事メタ + 本文 embedding を BQ に入れる
 * @graph-connects devto-api [reads_from] /api/articles で記事一覧 + 本文を fetch
 * @graph-connects bigquery [writes_to] contents (source=devto) + authored edges (Ryan → 記事)
 */

import { deterministicId } from "../common/id.js";
import type { EdgeInput, NodeInput, ParseResult } from "../common/types.js";
import { SELF_PERSON_ID } from "./threads.js";

/** @graph-connects none */
export const DEVTO_API_BASE = "https://dev.to";

/**
 * description / body の trim + 空判定 helper。
 *
 * @graph-connects none
 */
export function isNonEmptyText(s: string | undefined | null): s is string {
  return typeof s === "string" && s.length > 0;
}

/**
 * default username (Ryan の dev.to handle)。2026-05-06 に
 * `ryosuke_tsuji_f08e20fdca1` から `ryantsuji` に rename。
 *
 * @graph-connects none
 */
export function defaultDevtoUsername(): string {
  return "ryantsuji";
}

/**
 * 記事 id から detail endpoint URL を組み立てる helper。
 *
 * @graph-connects none
 */
export function buildDevtoDetailUrl(id: number): string {
  return `${DEVTO_API_BASE}/api/articles/${id}`;
}

/**
 * 本文 markdown を 1 行化 (whitespace collapse + trim)。
 *
 * @graph-connects none
 */
export function trimBody(body: string): string {
  return body.replace(/\s+/g, " ").trim();
}

export interface DevtoListArticle {
  id: number;
  title: string;
  description?: string;
  slug: string;
  url: string;
  published_at: string;
  tag_list?: string[];
  positive_reactions_count?: number;
  comments_count?: number;
  reading_time_minutes?: number;
}

export interface DevtoDetail {
  body_markdown?: string;
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
 * `/api/articles?username=...&page=N&per_page=30` を空配列が返るまで paginate。
 *
 * @graph-connects devto-api [reads_from] paginated list
 */
export async function fetchDevtoArticles(
  username: string,
  fetcher: FetchFn = defaultFetcher(),
): Promise<DevtoListArticle[]> {
  const out: DevtoListArticle[] = [];
  for (let page = 1; page <= 50; page++) {
    const url = `${DEVTO_API_BASE}/api/articles?username=${encodeURIComponent(username)}&page=${page}&per_page=30`;
    const res = await fetcher(url);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`dev.to list ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as DevtoListArticle[];
    if (!Array.isArray(data) || data.length === 0) break;
    out.push(...data);
    if (data.length < 30) break;
  }
  return out;
}

/**
 * 個別記事の本文を取得 (markdown)。失敗時 / 不在時は空文字。
 *
 * @graph-connects devto-api [reads_from] 単一記事
 */
export async function fetchDevtoBody(
  id: number,
  fetcher: FetchFn = defaultFetcher(),
): Promise<string> {
  const url = buildDevtoDetailUrl(id);
  const res = await fetcher(url);
  if (!res.ok) return "";
  const data = (await res.json()) as DevtoDetail;
  return data.body_markdown ?? "";
}

/**
 * dev.to 記事 1 件を NodeInput (contents) に変換。
 *
 * @graph-connects none
 */
export function devtoArticleToNode(
  article: DevtoListArticle,
  body: string,
  username: string,
): NodeInput {
  const id = deterministicId("devto", String(article.id));
  const description = article.description?.trim() ?? "";
  const bodyTrimmed = trimBody(body);
  const summaryParts = [article.title, description, bodyTrimmed.slice(0, 500)].filter(
    isNonEmptyText,
  );
  return {
    kind: "contents",
    id,
    fields: {
      content_id: id,
      source: "devto",
      external_id: String(article.id),
      url: article.url,
      title: article.title,
      body_md: body || description || "",
      published_at: article.published_at,
      author_person_id: SELF_PERSON_ID,
    },
    body_summary: summaryParts.join("\n\n"),
    metadata: {
      source: "devto",
      slug: article.slug,
      tags: article.tag_list ?? [],
      reactions: article.positive_reactions_count ?? null,
      comments: article.comments_count ?? null,
      reading_time_minutes: article.reading_time_minutes ?? null,
      author_handle: username,
    },
    first_seen_at: article.published_at,
  };
}

/**
 * dev.to の自分のアカウント全記事を取り込む parser entry。
 *
 * @graph-connects devto-api [reads_from] 全記事 + 本文
 * @graph-connects bigquery [writes_to] contents + personal_edges (authored)
 */
export async function parseDevto(
  opts: { username?: string; fetcher?: FetchFn } = {},
): Promise<ParseResult> {
  const username = opts.username ?? defaultDevtoUsername();
  const fetcher = opts.fetcher;
  const articles = await fetchDevtoArticles(username, fetcher);
  const nodes: NodeInput[] = [];
  const edges: EdgeInput[] = [];
  for (const article of articles) {
    const body = await fetchDevtoBody(article.id, fetcher);
    const node = devtoArticleToNode(article, body, username);
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
  return { source: "devto", nodes, edges };
}
