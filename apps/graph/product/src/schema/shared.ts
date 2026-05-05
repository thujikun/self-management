/**
 * 全 graph schema (product / release / personal) で共有する constants と field 定義。
 *
 * `BQ_DATASET` / `NODE_TABLES` / 共通 column (timestamp + embedding) / `EMBEDDING_MODEL` 等を
 * 1 箇所に集約することで、3 つの sub-graph schema 間の整合を SSoT として担保する。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business 個人グラフ全 sub-graph 共通の SSoT 定数 (dataset 名・テーブル名 enum・共通カラム・embedding model)。スキーマ整合性を 1 箇所で握る基盤
 * @graph-connects bigquery [writes_to] 全テーブル定義の出発点 (consumed by init-bq / migrate)
 */

import type { TableSchema } from "@google-cloud/bigquery";

/**
 * BQ dataset 名。Pulumi `infra/core` で provision される。
 *
 * @graph-connects none
 */
export const BQ_DATASET = "ryan";

/**
 * 全 node table が属するテーブル名 enum。
 * polymorphic edges の src_kind / tgt_kind の値に使う (= テーブル名と一致させる)。
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
 * 各 node row に共通する timestamp 列。
 *
 * @graph-connects none
 */
export const COMMON_TIMESTAMP_FIELDS: TableSchema["fields"] = [
  { name: "first_seen_at", type: "TIMESTAMP", mode: "REQUIRED" },
  { name: "updated_at", type: "TIMESTAMP", mode: "REQUIRED" },
];

/**
 * 全 node table 共通の embedding 列。`body_summary` を入力として
 * gemini-embedding-2 (3072 次元) を直接 row に持たせる。
 *
 * vector index を後付けする時は `CREATE VECTOR INDEX ... ON <table>(embedding)`。
 * embedding が未生成の row は embedding=[]、embedding_model=NULL。
 *
 * @graph-connects none
 */
export const COMMON_EMBEDDING_FIELDS: TableSchema["fields"] = [
  {
    name: "embedding",
    type: "FLOAT64",
    mode: "REPEATED", // ARRAY<FLOAT64>
  },
  { name: "embedding_model", type: "STRING", mode: "NULLABLE" },
];

/**
 * 全 BQ row に乗る common metadata field。型固有でない補助情報を JSON で保持。
 */
export interface BaseRowFields {
  metadata: Record<string, unknown> | null;
  embedding: number[] | null;
  embedding_model: string | null;
  first_seen_at: string; // ISO 8601
  updated_at: string;
}

// embedding model 定数 (EMBEDDING_MODEL / EMBEDDING_DIMENSIONS / EMBEDDING_LOCATION) は
// `@self/embedding` package に集約。schema 側から re-export しない (依存方向を schema → embedding に
// 一方化するため、schema は embedding を知らない)。

/**
 * 1 つの BQ table の作成に必要な定義 (init-bq.ts が消費)。
 */
export interface TableDefinition {
  name: string;
  options: {
    schema: TableSchema;
    timePartitioning?: { type: "DAY" | "HOUR" | "MONTH" | "YEAR"; field: string };
    clustering?: { fields: string[] };
  };
}
