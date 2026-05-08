/**
 * `index.ts` (parseCode entry) の unit test。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business buildDescription / exportToNode / nodeToResolverNode / parseCode end-to-end の純粋ロジック検証。temp dir 上の小さい monorepo で全段網羅
 * @graph-connects none
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deterministicId } from "../../common/id.js";
import { buildDescription, exportToNode, nodeToResolverNode, parseCode } from "./index.js";
import type { ParsedExport } from "./parser.js";

const sampleExport: ParsedExport = {
  name: "fooFn",
  filePath: "apps/graph/product/src/x.ts",
  startLine: 10,
  endLine: 30,
  isExported: true,
  tags: {
    nodeType: "Function",
    stack: "ryan-product-graph",
    domains: ["graph", "infra"],
    business: "X 取り込み parser",
    connects: [
      {
        target: "bigquery",
        relationship: "writes_to",
        cardinality: null,
        via: null,
        description: "BQ 書き込み",
      },
    ],
  },
};

describe("buildDescription", () => {
  it("includes nodeType, name, business, domains, stack, file path", () => {
    const d = buildDescription(sampleExport);
    expect(d).toContain("Function: fooFn");
    expect(d).toContain("ビジネス: X 取り込み parser");
    expect(d).toContain("ドメイン: graph, infra");
    expect(d).toContain("スタック: ryan-product-graph");
    expect(d).toContain("ファイル: apps/graph/product/src/x.ts");
  });

  it("falls back to 'Function' when nodeType is null and skips empty optional lines", () => {
    const e: ParsedExport = {
      ...sampleExport,
      tags: { nodeType: null, stack: null, domains: [], business: null, connects: [] },
    };
    const d = buildDescription(e);
    expect(d.split("\n")).toEqual(["Function: fooFn", `ファイル: ${e.filePath}`]);
  });
});

describe("exportToNode", () => {
  it("maps to product_graph_nodes NodeInput with deterministic id", () => {
    const n = exportToNode(sampleExport);
    expect(n.kind).toBe("product_graph_nodes");
    expect(n.id).toBe(deterministicId("code-symbol", "apps/graph/product/src/x.ts:fooFn"));
    expect(n.fields.node_type).toBe("Function");
    expect(n.fields.qualified_name).toBe("apps/graph/product/src/x.ts:fooFn");
    expect(n.fields.path).toBe("apps/graph/product/src/x.ts");
    expect(n.fields.stack).toBe("ryan-product-graph");
    // domain は first
    expect(n.fields.domain).toBe("graph");
    expect(n.body_summary).toContain("Function: fooFn");
    const md = n.metadata as { domains: string[]; is_exported: boolean };
    expect(md.domains).toEqual(["graph", "infra"]);
    expect(md.is_exported).toBe(true);
  });
});

describe("nodeToResolverNode", () => {
  it("extracts id/name/qualifiedName/path", () => {
    const r = nodeToResolverNode(exportToNode(sampleExport));
    expect(r.id).toBeDefined();
    expect(r.name).toBe("fooFn");
    expect(r.qualifiedName).toBe("apps/graph/product/src/x.ts:fooFn");
    expect(r.path).toBe("apps/graph/product/src/x.ts");
  });

  it("returns path=null when fields.path is null/undefined", () => {
    const stubLikeNode = {
      kind: "product_graph_nodes" as const,
      id: "stub-1",
      fields: { name: "ext", qualified_name: "ext", path: null },
    };
    expect(nodeToResolverNode(stubLikeNode).path).toBeNull();
  });
});

describe("exportToNode (edge cases)", () => {
  it("domain falls back to null when domains is empty", () => {
    const e: ParsedExport = {
      ...sampleExport,
      tags: { ...sampleExport.tags, domains: [] },
    };
    expect(exportToNode(e).fields.domain).toBeNull();
  });
});

describe("parseCode (end-to-end with temp dir)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "code-parse-"));
    mkdirSync(join(tmp, "apps/graph/product/src"), { recursive: true });
    writeFileSync(
      join(tmp, "apps/graph/product/src/a.ts"),
      `/**
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business helper
 */

/** @graph-connects bigquery [reads_from] BQ から SELECT */
export function fnA() {}
`,
    );
    writeFileSync(
      join(tmp, "apps/graph/product/src/b.ts"),
      `/**
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business sibling
 */

/** @graph-connects fnA [calls] fnA を呼ぶ */
export function fnB() {}
`,
    );
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("emits 2 symbol nodes + 1 stub (bigquery) and 2 edges with proper resolution", async () => {
    const result = await parseCode({ cwd: tmp });
    expect(result.source).toBe("code");
    // 2 symbol + 1 stub for "bigquery"
    expect(result.nodes).toHaveLength(3);
    const stub = result.nodes.find((n) => n.fields.name === "bigquery");
    expect(stub).toBeDefined();
    expect(stub!.fields.node_type).toBe("BigQueryDataset");

    expect(result.edges).toHaveLength(2);
    const edgeTypes = result.edges.map((e) => e.edge_type).sort();
    expect(edgeTypes).toEqual(["calls", "reads_from"]);
    // fnB → fnA は resolution が効いて両方 known node
    const callsEdge = result.edges.find((e) => e.edge_type === "calls");
    expect(callsEdge!.tgt_id).toBe(
      deterministicId("code-symbol", "apps/graph/product/src/a.ts:fnA"),
    );
  });

  it("inherits file-level tags into declarations (stack/domain on each node)", async () => {
    const result = await parseCode({ cwd: tmp });
    const symbolNodes = result.nodes.filter(
      (n) => (n.metadata as { is_exported?: boolean })?.is_exported === true,
    );
    for (const n of symbolNodes) {
      expect(n.fields.stack).toBe("ryan-product-graph");
      expect(n.fields.domain).toBe("graph");
    }
  });
});
