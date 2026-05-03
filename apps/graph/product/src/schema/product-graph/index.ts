/**
 * product-graph schema (cortex-product-graph 同型)。
 *
 * self-management 自身の technical structure を統合。
 * code (Function/Module/Class) + db (BQ Table/Column/Schema) + docs + infra (Stack/CronSchedule/PubSubTopic) + Domain。
 */

import type { TableSchema } from "@google-cloud/bigquery";
import {
  COMMON_TIMESTAMP_FIELDS,
  type BaseRowFields,
  type TableDefinition,
} from "../shared.js";

/**
 * product-graph 内の node 種別。1 table + discriminator pattern (cortex 同型)。
 * 新 type を追加する場合はこの list に足す。
 */
export const PRODUCT_NODE_TYPES = [
  // code
  "Function",
  "Module",
  "Class",

  // boundary nodes (cortex 同型)
  "ApiEndpoint",
  "Page",
  "FirestoreCollection",
  "BigQueryTable",
  "BigQueryView",
  "BigQueryDataset",
  "CloudRunJob",
  "CloudRunService",
  "PubSubTopic",
  "CronSchedule",
  "SlackBot",

  // db schema (db-graph 相当)
  "Table",
  "Column",
  "Schema",

  // documentation
  "Document",

  // organizational
  "Domain", // source code domain (e.g. "graph", "x-runtime", "content-pipeline")
  "Stack", // Pulumi stack (e.g. "core", "ryan-product-graph")
] as const;

export type ProductNodeType = (typeof PRODUCT_NODE_TYPES)[number];

/**
 * product-graph 内 edge 種別。
 */
export const PRODUCT_EDGE_TYPES = [
  // code relations
  "calls", // Function → Function
  "queries", // Function → Table (BQ)
  "reads_from", // Function → Firestore/BQ
  "writes_to", // Function → Firestore/BQ
  "publishes", // Function → PubSubTopic
  "triggers", // CronSchedule → CloudRunService

  // categorization
  "in_domain", // any → Domain
  "in_stack", // any → Stack

  // db schema
  "has_table", // Schema → Table
  "has_column", // Table → Column

  // docs
  "documented_by", // Function/Module → Document
] as const;

export type ProductEdgeType = (typeof PRODUCT_EDGE_TYPES)[number];

export const PRODUCT_GRAPH_NODES_TABLE = "product_graph_nodes";
export const PRODUCT_GRAPH_EDGES_TABLE = "product_graph_edges";

const PRODUCT_GRAPH_NODES_SCHEMA: TableSchema = {
  fields: [
    { name: "node_id", type: "STRING", mode: "REQUIRED" },
    { name: "node_type", type: "STRING", mode: "REQUIRED" },
    { name: "name", type: "STRING", mode: "REQUIRED" }, // Function 名 / Module 名 / Domain 名 等
    { name: "qualified_name", type: "STRING", mode: "NULLABLE" }, // path:name 等の full id
    { name: "path", type: "STRING", mode: "NULLABLE" }, // ファイル / リソースのパス
    { name: "description", type: "STRING", mode: "NULLABLE" }, // 短い概要 (semantic search の input)
    { name: "stack", type: "STRING", mode: "NULLABLE" }, // 所属 Pulumi stack
    { name: "domain", type: "STRING", mode: "NULLABLE" }, // 所属 source code domain
    { name: "metadata", type: "JSON", mode: "NULLABLE" },
    ...COMMON_TIMESTAMP_FIELDS,
  ],
};

const PRODUCT_GRAPH_EDGES_SCHEMA: TableSchema = {
  fields: [
    { name: "edge_id", type: "STRING", mode: "REQUIRED" },
    { name: "edge_type", type: "STRING", mode: "REQUIRED" },
    { name: "src_node_id", type: "STRING", mode: "REQUIRED" },
    { name: "tgt_node_id", type: "STRING", mode: "REQUIRED" },
    { name: "via", type: "STRING", mode: "NULLABLE" }, // パラメータレベル追跡 (例: queries の WHERE 列名)
    { name: "properties", type: "JSON", mode: "NULLABLE" },
    { name: "created_at", type: "TIMESTAMP", mode: "REQUIRED" },
  ],
};

export const PRODUCT_GRAPH_TABLES: TableDefinition[] = [
  {
    name: PRODUCT_GRAPH_NODES_TABLE,
    options: {
      schema: PRODUCT_GRAPH_NODES_SCHEMA,
      timePartitioning: { type: "DAY", field: "first_seen_at" },
      clustering: { fields: ["node_type", "domain"] },
    },
  },
  {
    name: PRODUCT_GRAPH_EDGES_TABLE,
    options: {
      schema: PRODUCT_GRAPH_EDGES_SCHEMA,
      timePartitioning: { type: "DAY", field: "created_at" },
      clustering: { fields: ["edge_type", "src_node_id"] },
    },
  },
];

export interface ProductGraphNodeRow extends BaseRowFields {
  node_id: string;
  node_type: ProductNodeType;
  name: string;
  qualified_name: string | null;
  path: string | null;
  description: string | null;
  stack: string | null;
  domain: string | null; // Domain node の `name` (例: "graph")
}

export interface ProductGraphEdgeRow {
  edge_id: string;
  edge_type: ProductEdgeType;
  src_node_id: string;
  tgt_node_id: string;
  via: string | null;
  properties: Record<string, unknown> | null;
  created_at: string;
}
