/**
 * `list_recent` MCP tool。
 *
 * 指定 kind の node を時系列降順で N 件返す。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business 「最近 X した release / 投稿 / decision」を引く MCP tool。daily summary の起点になる
 * @graph-connects bigquery [reads_from] kind 別に時系列 column で sort
 */

import { PK_COLUMN, PROJECT_ID, TITLE_EXPR, query, type NodeTable } from "../bq.js";

export interface ListRecentInput {
  kind: NodeTable;
  since?: string; // ISO 8601
  limit?: number;
}

export interface ListRecentRow {
  id: string;
  title: string;
  body_summary: string | null;
  ts: string;
}

/**
 * 各 table の "時系列順序付け column" を返す。
 *
 * @graph-connects none
 */
export function timeOrderColumn(kind: NodeTable): string {
  switch (kind) {
    case "release_notes":
      return "released_at";
    case "decisions":
      return "decided_at";
    case "events":
      return "occurred_at";
    case "contents":
      return "COALESCE(published_at, first_seen_at)";
    default:
      return "first_seen_at";
  }
}

/**
 * @graph-connects bigquery [reads_from] kind 別 SELECT
 */
export async function listRecent(input: ListRecentInput): Promise<ListRecentRow[]> {
  const limit = input.limit ?? 20;
  const ts = timeOrderColumn(input.kind);
  const summary = input.kind === "product_graph_nodes" ? "description" : "body_summary";
  const sinceCond = input.since ? `WHERE ${ts} >= @since` : "";
  const params: Record<string, unknown> = { lim: limit };
  if (input.since) params.since = input.since;

  const sql = `
    SELECT
      ${PK_COLUMN[input.kind]} AS id,
      ${TITLE_EXPR[input.kind]} AS title,
      ${summary} AS body_summary,
      CAST(${ts} AS STRING) AS ts
    FROM \`${PROJECT_ID}.ryan.${input.kind}\`
    ${sinceCond}
    ORDER BY ${ts} DESC
    LIMIT @lim
  `;
  return query<ListRecentRow>(sql, params);
}
