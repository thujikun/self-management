/**
 * ryan-product-graph 全 schema の SSoT。
 * 3 graphs × 10 BQ tables を統合的に export する。
 *
 * - product-graph: ryan.product_graph_nodes, ryan.product_graph_edges
 * - release-note: ryan.release_notes, ryan.release_edges
 * - personal-graph: ryan.persons, ryan.contents, ryan.decisions, ryan.topics, ryan.events, ryan.personal_edges
 *
 * cross-graph edges (例: release_note → product_graph_nodes) は edges 側のテーブル
 * (release_edges) に格納。src_kind / tgt_kind が `NODE_TABLES` の値で polymorphic 参照。
 */

export * from "./shared.js";
export * from "./product-graph/index.js";
export * from "./release-note/index.js";
export * from "./personal-graph/index.js";

import { PRODUCT_GRAPH_TABLES } from "./product-graph/index.js";
import { RELEASE_NOTE_TABLES } from "./release-note/index.js";
import { PERSONAL_GRAPH_TABLES } from "./personal-graph/index.js";
import type { TableDefinition } from "./shared.js";

/**
 * BQ table 全部 (init-bq.ts が消費)。
 */
export const ALL_TABLES: readonly TableDefinition[] = [
  ...PRODUCT_GRAPH_TABLES,
  ...RELEASE_NOTE_TABLES,
  ...PERSONAL_GRAPH_TABLES,
];
