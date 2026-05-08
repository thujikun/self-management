/**
 * `edges.ts` の unit test (resolution 全 7 path + stub 生成)。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business resolveTarget の 7 路 (name/this/obj/qualified_name/case-insensitive/hyphen/stub) と generateExplicitEdges の stub 生成、edge_type 反映、none skip を網羅
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";
import { deterministicId } from "../../common/id.js";
import {
  BOUNDARY_NODE_TYPE,
  generateExplicitEdges,
  inferNodeType,
  resolveTarget,
  stackRootOf,
  stubNodeId,
  symbolNodeId,
  type ResolverNode,
} from "./edges.js";
import type { ParsedExport } from "./parser.js";

function makeExport(
  filePath: string,
  name: string,
  connects: ParsedExport["tags"]["connects"],
): ParsedExport {
  return {
    filePath,
    name,
    startLine: 1,
    endLine: 5,
    isExported: true,
    tags: {
      nodeType: null,
      stack: null,
      domains: [],
      business: null,
      connects,
    },
  };
}

function nodeRef(filePath: string, name: string): ResolverNode {
  const id = symbolNodeId(filePath, name);
  return { id, name, qualifiedName: `${filePath}:${name}`, path: filePath };
}

describe("symbolNodeId / stubNodeId / stackRootOf", () => {
  it("symbolNodeId is deterministic from path:name", () => {
    expect(symbolNodeId("a/b.ts", "foo")).toBe(deterministicId("code-symbol", "a/b.ts:foo"));
  });

  it("stubNodeId is deterministic from target string", () => {
    expect(stubNodeId("bigquery")).toBe(deterministicId("code-stub", "bigquery"));
  });

  it("stackRootOf takes first 3 path segments", () => {
    expect(stackRootOf("apps/graph/product/src/foo.ts")).toBe("apps/graph/product");
    expect(stackRootOf("a/b.ts")).toBe("a/b.ts");
  });
});

describe("inferNodeType", () => {
  it("returns boundary mapping for known names", () => {
    expect(inferNodeType("bigquery")).toBe("BigQueryDataset");
    expect(inferNodeType("cloud-scheduler")).toBe("CronSchedule");
    expect(inferNodeType("x-api")).toBe("ApiEndpoint");
  });

  it("detects firestore prefix", () => {
    expect(inferNodeType("firestore.users")).toBe("FirestoreCollection");
  });

  it("detects dataset.table pattern", () => {
    expect(inferNodeType("ryan.contents")).toBe("BigQueryTable");
  });

  it('falls back to "Function" for unknown', () => {
    expect(inferNodeType("someRandomThing")).toBe("Function");
  });

  it("BOUNDARY_NODE_TYPE keys are non-empty", () => {
    expect(Object.keys(BOUNDARY_NODE_TYPE).length).toBeGreaterThan(0);
  });
});

describe("resolveTarget", () => {
  const nodes = [
    nodeRef("apps/graph/product/src/a.ts", "uniqueFn"),
    nodeRef("apps/graph/product/src/a.ts", "Foo.bar"), // class method
    nodeRef("apps/graph/product/src/sub/b.ts", "siblingFn"),
    nodeRef("packages/otel/src/log.ts", "ambig"),
    nodeRef("apps/graph/product/src/dup.ts", "ambig"),
  ];
  const ctx = {
    qualifiedToId: new Map(nodes.map((n) => [n.qualifiedName, n.id])),
    nameToIds: nodes.reduce((m, n) => {
      const list = m.get(n.name) ?? [];
      list.push(n.id);
      m.set(n.name, list);
      return m;
    }, new Map<string, string[]>()),
    allNodes: nodes,
  };

  it("path 1: unique name → resolved", () => {
    expect(resolveTarget("uniqueFn", "apps/graph/product/src/x.ts", ctx)).toBe(
      symbolNodeId("apps/graph/product/src/a.ts", "uniqueFn"),
    );
  });

  it("path 1: ambiguous name prefers same-stack", () => {
    expect(resolveTarget("ambig", "apps/graph/product/src/x.ts", ctx)).toBe(
      symbolNodeId("apps/graph/product/src/dup.ts", "ambig"),
    );
  });

  it("path 2: this.method → ClassName.method in same file", () => {
    expect(resolveTarget("this.bar", "apps/graph/product/src/a.ts", ctx)).toBe(
      symbolNodeId("apps/graph/product/src/a.ts", "Foo.bar"),
    );
  });

  it("path 2 fallback: this.method → same directory ClassName.method when not in same file", () => {
    const nodesD = [
      {
        id: "siblingMethod",
        name: "Bar.run",
        qualifiedName: "apps/graph/product/src/sibling.ts:Bar.run",
        path: "apps/graph/product/src/sibling.ts",
      },
    ];
    const ctxD = {
      qualifiedToId: new Map(),
      nameToIds: new Map<string, string[]>(),
      allNodes: nodesD,
    };
    expect(resolveTarget("this.run", "apps/graph/product/src/main.ts", ctxD)).toBe("siblingMethod");
  });

  it("path 7: returns stub_id for unresolvable target", () => {
    expect(resolveTarget("totally-unknown", "apps/graph/product/src/x.ts", ctx)).toBe(
      stubNodeId("totally-unknown"),
    );
  });

  it("path 6: hyphen prefix-suffix matches by name + path-prefix", () => {
    const nodes2 = [
      ...nodes,
      {
        id: symbolNodeId("apps/graph/product/src/migrate/sources/x/index.ts", "parseX"),
        name: "parseX",
        qualifiedName: "apps/graph/product/src/migrate/sources/x/index.ts:parseX",
        path: "apps/graph/product/src/migrate/sources/x/index.ts",
      },
    ];
    const ctx2 = {
      qualifiedToId: new Map(nodes2.map((n) => [n.qualifiedName, n.id])),
      nameToIds: nodes2.reduce((m, n) => {
        const list = m.get(n.name) ?? [];
        list.push(n.id);
        m.set(n.name, list);
        return m;
      }, new Map<string, string[]>()),
      allNodes: nodes2,
    };
    expect(resolveTarget("x-parseX", "apps/graph/product/src/y.ts", ctx2)).toBe(
      symbolNodeId("apps/graph/product/src/migrate/sources/x/index.ts", "parseX"),
    );
  });

  it("path 3: obj.method → resolves to obj node in same stack", () => {
    const nodes2 = [
      ...nodes,
      {
        id: symbolNodeId("apps/graph/product/src/svc.ts", "service"),
        name: "service",
        qualifiedName: "apps/graph/product/src/svc.ts:service",
        path: "apps/graph/product/src/svc.ts",
      },
      {
        id: symbolNodeId("packages/other/src/svc.ts", "service"),
        name: "service",
        qualifiedName: "packages/other/src/svc.ts:service",
        path: "packages/other/src/svc.ts",
      },
    ];
    const ctx2 = {
      qualifiedToId: new Map(nodes2.map((n) => [n.qualifiedName, n.id])),
      nameToIds: nodes2.reduce((m, n) => {
        const list = m.get(n.name) ?? [];
        list.push(n.id);
        m.set(n.name, list);
        return m;
      }, new Map<string, string[]>()),
      allNodes: nodes2,
    };
    expect(resolveTarget("service.run", "apps/graph/product/src/x.ts", ctx2)).toBe(
      symbolNodeId("apps/graph/product/src/svc.ts", "service"),
    );
  });

  it("path 3 not entered: target has dot but obj not in nameToIds → falls through", () => {
    expect(resolveTarget("unknownObj.run", "apps/graph/product/src/x.ts", ctx)).toBe(
      stubNodeId("unknownObj.run"),
    );
  });

  it("path 5: case-insensitive name match same-stack wins", () => {
    const nodesC = [
      {
        id: "sameStack",
        name: "foo",
        qualifiedName: "apps/graph/product/src/y.ts:foo",
        path: "apps/graph/product/src/y.ts",
      },
      {
        id: "otherStack",
        name: "foo",
        qualifiedName: "packages/other/src/y.ts:foo",
        path: "packages/other/src/y.ts",
      },
    ];
    const ctxC = {
      qualifiedToId: new Map(),
      nameToIds: new Map<string, string[]>(),
      allNodes: nodesC,
    };
    expect(resolveTarget("FOO", "apps/graph/product/src/x.ts", ctxC)).toBe("sameStack");
  });

  it("path 3: obj.method with single match (no same-stack) returns that node", () => {
    const nodes3 = [
      {
        id: "loneObj",
        name: "lone",
        qualifiedName: "packages/other/src/x.ts:lone",
        path: "packages/other/src/x.ts",
      },
    ];
    const ctx3 = {
      qualifiedToId: new Map(),
      nameToIds: nodes3.reduce((m, n) => {
        m.set(n.name, [n.id]);
        return m;
      }, new Map<string, string[]>()),
      allNodes: nodes3,
    };
    expect(resolveTarget("lone.method", "apps/graph/product/src/x.ts", ctx3)).toBe("loneObj");
  });

  it("path 5: case-insensitive name match (target='Foo' → name='foo' fallback across stacks)", () => {
    const nodesC = [
      {
        id: "X",
        name: "foo",
        qualifiedName: "packages/other/src/y.ts:foo",
        path: "packages/other/src/y.ts",
      },
    ];
    const ctxC = {
      qualifiedToId: new Map(),
      nameToIds: new Map<string, string[]>(),
      allNodes: nodesC,
    };
    // 完全一致 (path 1) でも 末尾一致 (path 4) でもなく、case-insensitive (path 5) で hit
    expect(resolveTarget("Foo", "apps/graph/product/src/x.ts", ctxC)).toBe("X");
  });

  it("path 4: qualified_name suffix match", () => {
    const onlyQualifiedNodes = [
      {
        id: "X",
        name: "weird",
        qualifiedName: "apps/foo/bar.ts:weird",
        path: "apps/foo/bar.ts",
      },
    ];
    // Use a name that doesn't match (so path1 fails) but qualified suffix matches
    const ctxQ = {
      qualifiedToId: new Map(),
      nameToIds: new Map<string, string[]>(),
      allNodes: onlyQualifiedNodes,
    };
    expect(resolveTarget("weird", "apps/foo/x.ts", ctxQ)).toBe("X");
  });
});

describe("generateExplicitEdges", () => {
  const exp = makeExport("apps/graph/product/src/foo.ts", "fnA", [
    { target: "fnB", relationship: "calls", cardinality: null, via: null, description: "calls B" },
    {
      target: "bigquery",
      relationship: "writes_to",
      cardinality: "many",
      via: null,
      description: "BQ write",
    },
    { target: "none", relationship: "none", cardinality: null, via: null, description: "" },
  ]);

  it("generates 2 edges (none is skipped) and 1 stub for unresolved 'bigquery'", () => {
    const fnB: ResolverNode = {
      id: symbolNodeId("apps/graph/product/src/sibling.ts", "fnB"),
      name: "fnB",
      qualifiedName: "apps/graph/product/src/sibling.ts:fnB",
      path: "apps/graph/product/src/sibling.ts",
    };
    const fnA: ResolverNode = {
      id: symbolNodeId("apps/graph/product/src/foo.ts", "fnA"),
      name: "fnA",
      qualifiedName: "apps/graph/product/src/foo.ts:fnA",
      path: "apps/graph/product/src/foo.ts",
    };
    const result = generateExplicitEdges([exp], [fnA, fnB]);
    expect(result.edges).toHaveLength(2);
    expect(result.stubNodes).toHaveLength(1);
    expect(result.stubNodes[0].fields.node_type).toBe("BigQueryDataset");
    expect(result.stubNodes[0].fields.name).toBe("bigquery");
    expect((result.stubNodes[0].metadata as { external: boolean }).external).toBe(true);

    const edgeTypes = result.edges.map((e) => e.edge_type).sort();
    expect(edgeTypes).toEqual(["calls", "writes_to"]);
    expect(result.edges[0].src_kind).toBe("product_graph_nodes");
    expect(result.edges[0].tgt_kind).toBe("product_graph_nodes");
  });

  it("dedupes stub for repeated unresolved target across exports", () => {
    const exp2 = makeExport("apps/x.ts", "fn2", [
      { target: "external", relationship: "calls", cardinality: null, via: null, description: "" },
    ]);
    const exp3 = makeExport("apps/y.ts", "fn3", [
      { target: "external", relationship: "calls", cardinality: null, via: null, description: "" },
    ]);
    const result = generateExplicitEdges([exp2, exp3], []);
    expect(result.stubNodes).toHaveLength(1);
    expect(result.edges).toHaveLength(2);
  });

  it("no stub when target is resolved against existing nodes", () => {
    const exp2 = makeExport("apps/x.ts", "fn2", [
      { target: "fnB", relationship: "calls", cardinality: null, via: null, description: "" },
    ]);
    const fnB: ResolverNode = {
      id: symbolNodeId("apps/y.ts", "fnB"),
      name: "fnB",
      qualifiedName: "apps/y.ts:fnB",
      path: "apps/y.ts",
    };
    const result = generateExplicitEdges([exp2], [fnB]);
    expect(result.stubNodes).toHaveLength(0);
    expect(result.edges).toHaveLength(1);
  });

  it("propagates via and description into edge.via / properties", () => {
    const expV = makeExport("apps/x.ts", "fn", [
      { target: "ext", relationship: "calls", cardinality: "1", via: "http", description: "d" },
    ]);
    const result = generateExplicitEdges([expV], []);
    expect(result.edges[0].via).toBe("http");
    const props = result.edges[0].properties as { cardinality: string; description: string };
    expect(props.cardinality).toBe("1");
    expect(props.description).toBe("d");
  });
});
