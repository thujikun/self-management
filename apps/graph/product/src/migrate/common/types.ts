/**
 * Migration / ingest 中に parser が yield する中間型。
 * BQ row 型 (PersonRow / ContentRow / etc) は schema 側に定義済。
 *
 * ここでは parser → orchestrator → bq-merge の interchange 型を定義。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business parser から orchestrator へ流す中間型 (NodeInput / EdgeInput / ParseResult)。BQ row 型と直結せず、parser に table-specific column の知識を漏らさない buffer として機能
 * @graph-connects none
 */

import type { NodeTable } from "../../schema/index.js";

/**
 * 1 つの node を表現する parser 出力。
 * - `kind` で table 振り分け
 * - `id` は parser 側で `deterministicId(source, externalId)` 済
 * - `body_summary` は AI (= 私 = Claude) が手で書き起こす想定。parser は markdown 抽出のみ
 * - `embedding` は orchestrator が後段で gemini-embedding-2 を呼んで埋める
 */
export interface NodeInput {
  kind: NodeTable;
  id: string;
  /** type-specific column 値 (kind に依存) */
  fields: Record<string, unknown>;
  /** body_summary が必要な node のみ。ここから embedding 生成 */
  body_summary?: string | null;
  metadata?: Record<string, unknown> | null;
  first_seen_at?: string;
}

/**
 * 1 つの edge を表現する parser 出力。
 * id は orchestrator が `deterministicEdgeId` で生成する (parser は型のみ指定)。
 */
export interface EdgeInput {
  /** どの edge table に書くか */
  edge_table: "personal_edges" | "release_edges" | "product_graph_edges";
  edge_type: string;
  src_kind: NodeTable;
  src_id: string;
  tgt_kind: NodeTable;
  tgt_id: string;
  weight?: number | null;
  via?: string | null;
  properties?: Record<string, unknown> | null;
  created_at?: string;
}

/**
 * 1 つの source parser の出力。
 * orchestrator はこれらを集めて embedding 生成 → BQ MERGE。
 */
export interface ParseResult {
  source: string;
  nodes: NodeInput[];
  edges: EdgeInput[];
}
