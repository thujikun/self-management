import type { TableSchema } from "@google-cloud/bigquery";

/**
 * BQ dataset 名。Pulumi `infra/core` で provision される。
 */
export const BQ_DATASET = "ryan";

/**
 * 全 node table が属するテーブル名 enum。
 * polymorphic edges の src_kind / tgt_kind の値に使う (= テーブル名と一致させる)。
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
 */
export const COMMON_TIMESTAMP_FIELDS: TableSchema["fields"] = [
  { name: "first_seen_at", type: "TIMESTAMP", mode: "REQUIRED" },
  { name: "updated_at", type: "TIMESTAMP", mode: "REQUIRED" },
];

/**
 * 全 BQ row に乗る common metadata field。型固有でない補助情報を JSON で保持。
 */
export interface BaseRowFields {
  metadata: Record<string, unknown> | null;
  first_seen_at: string; // ISO 8601
  updated_at: string;
}

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
