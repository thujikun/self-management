/**
 * BigQuery client + 共通 helper。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business MCP server から BQ への薄いアクセス層。client インスタンスを 1 個だけ共有し、テスト時に差し替え可能にする factory を提供
 * @graph-connects bigquery [reads_from] graph 全テーブルへの read query
 */

import { BigQuery } from "@google-cloud/bigquery";

/** @graph-connects none */
export const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT ?? "ryan-self-management";
/** @graph-connects none */
export const LOCATION = "asia-northeast1";
/** @graph-connects none */
export const DATASET = "ryan";

/** @graph-connects none */
let _bq: BigQuery | null = null;

/**
 * BigQuery client を 1 度だけ作って共有する。test では `_setBqForTest` で差し替え可。
 *
 * @graph-connects none
 */
export function getBq(): BigQuery {
  if (!_bq) _bq = new BigQuery({ projectId: PROJECT_ID, location: LOCATION });
  return _bq;
}

/**
 * SELECT を実行して row 配列を返す。
 *
 * @graph-connects bigquery [reads_from] 任意の SELECT
 */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: Record<string, unknown>,
): Promise<T[]> {
  const [job] = await getBq().createQueryJob({
    query: sql,
    location: LOCATION,
    params,
  });
  const [rows] = await job.getQueryResults();
  return rows as T[];
}

/**
 * テスト hook: BigQuery client を差し替え。production からは呼ばないこと。
 *
 * @graph-connects none
 */
export function _setBqForTest(client: BigQuery | null): void {
  _bq = client;
}

/**
 * 全 node table 名 (search 対象)。
 *
 * @graph-connects none
 */
export const NODE_TABLES = [
  "persons",
  "contents",
  "decisions",
  "topics",
  "events",
  "release_notes",
  "product_graph_nodes",
] as const;

export type NodeTable = (typeof NODE_TABLES)[number];

/**
 * 各テーブルの primary key 列名。
 *
 * @graph-connects none
 */
export const PK_COLUMN: Record<NodeTable, string> = {
  persons: "person_id",
  contents: "content_id",
  decisions: "decision_id",
  topics: "topic_id",
  events: "event_id",
  release_notes: "release_note_id",
  product_graph_nodes: "node_id",
};

/**
 * embedding 検索用の "代表テキスト" 列。table によって title / name / body_summary が違う。
 *
 * @graph-connects none
 */
export const TITLE_EXPR: Record<NodeTable, string> = {
  persons: "COALESCE(display_name, primary_handle, person_id)",
  contents: "COALESCE(title, content_id)",
  decisions: "title",
  topics: "name",
  events: "title",
  release_notes: "title",
  product_graph_nodes: "name",
};

/**
 * 各 table の "要約" として使う SQL 式。body_summary 列が無い table は近い意味の
 * 別 column を使う。すべて output には `AS body_summary` で alias 統一する想定。
 *
 * @graph-connects none
 */
export const SUMMARY_EXPR: Record<NodeTable, string> = {
  persons: "bio",
  contents: "body_summary",
  decisions: "rationale_md",
  topics: "description",
  events: "description",
  release_notes: "body_summary",
  product_graph_nodes: "description",
};
