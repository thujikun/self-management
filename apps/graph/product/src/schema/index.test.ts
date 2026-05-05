/**
 * Schema barrel + 各 sub-graph の smoke import test。
 *
 * Schema files は data 定義 (const / interface / type) のみで実行時関数を持たないが、
 * coverage 測定のため import-level の evaluation を 1 度走らせて 100% lines を担保する。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business 全 schema (3 sub-graph 統合) の SSoT インテグリティを 1 ファイルで検証。テーブル定義の count、必須エクスポートの存在、edge polymorphic の前提整合 (NODE_TABLES vs 各 NODE_TYPE 値域) を smoke レベルで保証
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";
import {
  ALL_TABLES,
  BQ_DATASET,
  COMMON_EMBEDDING_FIELDS,
  COMMON_TIMESTAMP_FIELDS,
  CONTENT_SOURCES,
  NODE_TABLES,
  PERSONAL_EDGE_TYPES,
  PERSONAL_GRAPH_TABLES,
  PRODUCT_EDGE_TYPES,
  PRODUCT_GRAPH_TABLES,
  PRODUCT_NODE_TYPES,
  RELEASE_EDGE_TYPES,
  RELEASE_NOTE_TABLES,
} from "./index.js";

describe("schema barrel", () => {
  it("BQ_DATASET = 'ryan'", () => {
    expect(BQ_DATASET).toBe("ryan");
  });

  it("ALL_TABLES = product (2) + release (2) + personal (6) = 10", () => {
    expect(ALL_TABLES).toHaveLength(10);
    expect(PRODUCT_GRAPH_TABLES).toHaveLength(2);
    expect(RELEASE_NOTE_TABLES).toHaveLength(2);
    expect(PERSONAL_GRAPH_TABLES).toHaveLength(6);
  });

  it("NODE_TABLES enum length 7 で全 node table をカバー", () => {
    expect(NODE_TABLES).toHaveLength(7);
    expect(NODE_TABLES).toContain("persons");
    expect(NODE_TABLES).toContain("contents");
    expect(NODE_TABLES).toContain("decisions");
    expect(NODE_TABLES).toContain("topics");
    expect(NODE_TABLES).toContain("events");
    expect(NODE_TABLES).toContain("release_notes");
    expect(NODE_TABLES).toContain("product_graph_nodes");
  });

  it("COMMON_TIMESTAMP_FIELDS / COMMON_EMBEDDING_FIELDS が定義されている", () => {
    expect(COMMON_TIMESTAMP_FIELDS).toBeDefined();
    expect(COMMON_EMBEDDING_FIELDS).toBeDefined();
    const tsNames = (COMMON_TIMESTAMP_FIELDS ?? []).map((f) => (f as { name: string }).name);
    expect(tsNames).toContain("first_seen_at");
    expect(tsNames).toContain("updated_at");
    const embNames = (COMMON_EMBEDDING_FIELDS ?? []).map((f) => (f as { name: string }).name);
    expect(embNames).toContain("embedding");
    expect(embNames).toContain("embedding_model");
  });

  it("CONTENT_SOURCES に主要 platform が含まれる", () => {
    expect(CONTENT_SOURCES).toContain("x");
    expect(CONTENT_SOURCES).toContain("zenn");
    expect(CONTENT_SOURCES).toContain("devto");
  });

  it("edge type enum: PRODUCT / PERSONAL / RELEASE すべて非空", () => {
    expect(PRODUCT_EDGE_TYPES.length).toBeGreaterThan(0);
    expect(PERSONAL_EDGE_TYPES.length).toBeGreaterThan(0);
    expect(RELEASE_EDGE_TYPES.length).toBeGreaterThan(0);
  });

  it("PRODUCT_NODE_TYPES に code / db / docs の代表 type が含まれる", () => {
    expect(PRODUCT_NODE_TYPES).toContain("Function");
    expect(PRODUCT_NODE_TYPES).toContain("Table");
    expect(PRODUCT_NODE_TYPES).toContain("Document");
    expect(PRODUCT_NODE_TYPES).toContain("Domain");
    expect(PRODUCT_NODE_TYPES).toContain("Stack");
  });

  it("ALL_TABLES の各 def に schema + name が必須で揃っている", () => {
    for (const def of ALL_TABLES) {
      expect(def.name).toBeTruthy();
      expect(def.options.schema).toBeDefined();
      expect(def.options.schema.fields?.length ?? 0).toBeGreaterThan(0);
    }
  });
});
