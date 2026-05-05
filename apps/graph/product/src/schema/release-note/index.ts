/**
 * release-note graph schema。
 *
 * self-management 自身の changelog を時系列 graph 化。
 * release_note → product_graph_nodes (kind=Domain) で「どの domain の release か」、
 * release_note → product_graph_nodes (Function/Module 等) で「具体的に何が変わったか」を表現。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business self-management 自身の changelog を時系列 + cross-graph で構造化。release ごとに domain (どこの release か) と具体ノード (何が変わったか) を edges で記録
 * @graph-connects bigquery [writes_to] release_notes / release_edges 2 テーブルを定義
 */

import type { TableSchema } from "@google-cloud/bigquery";
import {
  COMMON_EMBEDDING_FIELDS,
  COMMON_TIMESTAMP_FIELDS,
  NODE_TABLES,
  type BaseRowFields,
  type NodeTable,
  type TableDefinition,
} from "../shared.js";

/** @graph-connects none */
export const RELEASE_NOTES_TABLE = "release_notes";
/** @graph-connects none */
export const RELEASE_EDGES_TABLE = "release_edges";

/**
 * release-note 内 / cross-graph で使う edge 種別。
 *
 * @graph-connects none
 */
export const RELEASE_EDGE_TYPES = [
  "derived_from", // release_note → release_note (前 release との関係)
  "tagged_with_domain", // release_note → product_graph_nodes (kind=Domain)
  "references", // release_note → product_graph_nodes (任意 type、具体的に何が変わったか)
  "affects", // release_note → product_graph_nodes (kind=Stack、影響を受ける Pulumi stack)
  "about_event", // release_note → events (関連 event があれば)
] as const;

export type ReleaseEdgeType = (typeof RELEASE_EDGE_TYPES)[number];

/** @graph-connects none */
const RELEASE_NOTES_SCHEMA: TableSchema = {
  fields: [
    { name: "release_note_id", type: "STRING", mode: "REQUIRED" },
    { name: "title", type: "STRING", mode: "REQUIRED" },
    { name: "body_md", type: "STRING", mode: "NULLABLE" },
    { name: "body_summary", type: "STRING", mode: "NULLABLE" },
    { name: "released_at", type: "TIMESTAMP", mode: "REQUIRED" },
    { name: "version", type: "STRING", mode: "NULLABLE" },
    { name: "metadata", type: "JSON", mode: "NULLABLE" },
    ...COMMON_EMBEDDING_FIELDS,
    ...COMMON_TIMESTAMP_FIELDS,
  ],
};

/** @graph-connects none */
const RELEASE_EDGES_SCHEMA: TableSchema = {
  fields: [
    { name: "edge_id", type: "STRING", mode: "REQUIRED" },
    { name: "edge_type", type: "STRING", mode: "REQUIRED" },
    { name: "src_kind", type: "STRING", mode: "REQUIRED" }, // 主に "release_notes"
    { name: "src_id", type: "STRING", mode: "REQUIRED" },
    { name: "tgt_kind", type: "STRING", mode: "REQUIRED" }, // "product_graph_nodes" / "release_notes" / "events"
    { name: "tgt_id", type: "STRING", mode: "REQUIRED" },
    { name: "properties", type: "JSON", mode: "NULLABLE" },
    { name: "created_at", type: "TIMESTAMP", mode: "REQUIRED" },
  ],
};

/**
 * release-note graph に属する全 table 定義。`init-bq` / `migrate` から消費。
 *
 * @graph-connects none
 */
export const RELEASE_NOTE_TABLES: TableDefinition[] = [
  {
    name: RELEASE_NOTES_TABLE,
    options: {
      schema: RELEASE_NOTES_SCHEMA,
      timePartitioning: { type: "DAY", field: "released_at" },
    },
  },
  {
    name: RELEASE_EDGES_TABLE,
    options: {
      schema: RELEASE_EDGES_SCHEMA,
      timePartitioning: { type: "DAY", field: "created_at" },
      clustering: { fields: ["edge_type", "src_id"] },
    },
  },
];

export interface ReleaseNoteRow extends BaseRowFields {
  release_note_id: string;
  title: string;
  body_md: string | null;
  body_summary: string | null;
  released_at: string;
  version: string | null;
}

export interface ReleaseEdgeRow {
  edge_id: string;
  edge_type: ReleaseEdgeType;
  src_kind: NodeTable;
  src_id: string;
  tgt_kind: NodeTable;
  tgt_id: string;
  properties: Record<string, unknown> | null;
  created_at: string;
}

/**
 * `NODE_TABLES` を import している事実を utility 化 (TS 用)。
 *
 * @graph-connects none
 */
export const VALID_NODE_TABLES = new Set<string>(NODE_TABLES);
