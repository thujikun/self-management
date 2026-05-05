/**
 * `search_nodes` MCP tool。
 *
 * 自然言語クエリを gemini-embedding-2 で embed → 全 node table を UNION ALL で
 * 横断 → COSINE distance で sort、上位 N を返す。
 *
 * embedding が無い row は対象外 (ARRAY_LENGTH > 0 で filter)。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business 自然言語で個人グラフ全 node を semantic search する MCP tool。query embedding と各 node の embedding の COSINE 距離で順位付け、kind フィルタで絞り込み可能
 * @graph-connects bigquery [reads_from] 全 node テーブルから embedding + 代表 column を読み出し
 * @graph-connects vertex-ai [calls] gemini-embedding-2 で query を embed
 */

import { embedText } from "@self/embedding";
import {
  NODE_TABLES,
  PK_COLUMN,
  PROJECT_ID,
  TITLE_EXPR,
  query,
  type NodeTable,
} from "../bq.js";

export interface SearchHit {
  kind: NodeTable;
  id: string;
  title: string;
  body_summary: string | null;
  cosine_distance: number;
}

export interface SearchInput {
  query: string;
  kind?: NodeTable;
  limit?: number;
}

/**
 * 各テーブル個別の SELECT を構築 (embedding 距離 + 代表 column)。
 *
 * @graph-connects none
 */
export function buildPerTableSelect(t: NodeTable): string {
  // product_graph_nodes は description column を持つ (body_summary は無い)。
  // 出力列名を body_summary に揃えるため AS で alias。
  const summaryExpr = t === "product_graph_nodes" ? "description" : "body_summary";
  return `
    SELECT
      '${t}' AS kind,
      ${PK_COLUMN[t]} AS id,
      ${TITLE_EXPR[t]} AS title,
      ${summaryExpr} AS body_summary,
      ML.DISTANCE(embedding, @qvec, 'COSINE') AS cosine_distance
    FROM \`${PROJECT_ID}.ryan.${t}\`
    WHERE ARRAY_LENGTH(embedding) > 0
  `;
}

/**
 * search 本体。embed 関数を inject 可能にしてテストを純粋にする。
 *
 * @graph-connects bigquery [reads_from] UNION ALL で全 node テーブル横断検索
 */
export async function searchNodes(
  input: SearchInput,
  embed: (text: string) => Promise<number[]> = (t) => embedText(t, "RETRIEVAL_QUERY"),
): Promise<SearchHit[]> {
  const limit = input.limit ?? 10;
  const qvec = await embed(input.query);
  const tables = input.kind ? [input.kind] : [...NODE_TABLES];
  const subSelects = tables.map(buildPerTableSelect);
  const sql = `
    WITH all_nodes AS (
      ${subSelects.join("\n      UNION ALL\n      ")}
    )
    SELECT * FROM all_nodes
    ORDER BY cosine_distance ASC
    LIMIT @lim
  `;
  return query<SearchHit>(sql, { qvec, lim: limit });
}
