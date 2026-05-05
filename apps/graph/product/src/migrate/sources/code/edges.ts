/**
 * `@graph-connects` から explicit edges を生成。target を name で解決、未解決は外部 stub node 化。
 *
 * cortex の `apps/graph/product/src/edge-detectors/explicit-edges.ts` を移植。
 *
 * 解決順序:
 *  1. name 完全一致 (一意 or 同 stack 優先)
 *  2. `this.method` → 同ファイル / 同ディレクトリ内のクラスメソッド
 *  3. `obj.method` → 同 stack 内の `obj` ノード
 *  4. qualified_name 末尾一致 (同 stack 優先)
 *  5. 大小無視の name 一致 (同 stack 優先)
 *  6. ハイフン区切り `prefix-suffix` → path に prefix を含むノードの suffix
 *  7. 解決不能 → external stub node を生成
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business cortex explicit-edges 移植。@graph-connects から target 名を既存 node に名前解決し、解決できない target は external stub node を seed する。同 stack 優先で多重マッチを抑制
 * @graph-connects none
 */

import { deterministicId } from "../../common/id.js";
import type { EdgeInput, NodeInput } from "../common/types.js";
import type { ParsedExport } from "./parser.js";

/** @graph-connects none */
const FIRESTORE_PREFIX = "firestore.";

/**
 * target → 推定 node_type マップ。boundary 名は明示、それ以外は推論。
 *
 * @graph-connects none
 */
export const BOUNDARY_NODE_TYPE: Record<string, string> = {
  bigquery: "BigQueryDataset",
  "bq-table": "BigQueryTable",
  vertex: "ApiEndpoint",
  "vertex-ai": "ApiEndpoint",
  "secret-manager": "ApiEndpoint",
  iam: "ApiEndpoint",
  "x-api": "ApiEndpoint",
  "cloud-run": "CloudRunService",
  "cloud-scheduler": "CronSchedule",
  "artifact-registry": "ApiEndpoint",
  "gcp-services": "ApiEndpoint",
  "grafana-cloud": "ApiEndpoint",
  opentelemetry: "ApiEndpoint",
  filesystem: "ApiEndpoint",
  git: "ApiEndpoint",
  gemini: "ApiEndpoint",
};

/**
 * `code-symbol` namespace の deterministic node_id。
 *
 * @graph-connects none
 */
export function symbolNodeId(filePath: string, name: string): string {
  return deterministicId("code-symbol", `${filePath}:${name}`);
}

/**
 * external stub の deterministic node_id。
 *
 * @graph-connects none
 */
export function stubNodeId(target: string): string {
  return deterministicId("code-stub", target);
}

/**
 * target 名から外部 node_type を推定 (BOUNDARY_NODE_TYPE → firestore prefix → dataset.table → Function fallback)。
 *
 * @graph-connects none
 */
export function inferNodeType(target: string): string {
  if (target in BOUNDARY_NODE_TYPE) return BOUNDARY_NODE_TYPE[target];
  if (target.includes(FIRESTORE_PREFIX)) return "FirestoreCollection";
  if (/^[a-z_]+\.[a-z_]+$/.test(target)) return "BigQueryTable";
  return "Function";
}

interface ResolveContext {
  /** export の qualified_name → node_id */
  qualifiedToId: Map<string, string>;
  /** name → node_id 配列 (multi match の場合あり) */
  nameToIds: Map<string, string[]>;
  /** 全 node の参照 (path/qualified_name 検索用) */
  allNodes: ResolverNode[];
}

/** edges 解決のために最低限必要な node 情報 (NodeInput を thin に切り出したもの)。 */
export interface ResolverNode {
  id: string;
  name: string;
  qualifiedName: string;
  path: string | null;
}

/**
 * source file path から擬似 stack root を抽出 (cortex 同型: 先頭 3 path segment)。
 *
 * @graph-connects none
 */
export function stackRootOf(filePath: string): string {
  return filePath.split("/").slice(0, 3).join("/");
}

/**
 * 1 つの target を node_id に解決。解決できなければ stub id を返す。
 *
 * @graph-connects none
 */
export function resolveTarget(
  target: string,
  sourceFilePath: string,
  ctx: ResolveContext,
): string {
  const sourceStack = stackRootOf(sourceFilePath);
  const sourceDir = sourceFilePath.replace(/\/[^/]+$/, "");

  // 1. name 完全一致
  const byName = ctx.nameToIds.get(target);
  if (byName?.length) {
    if (byName.length === 1) return byName[0];
    const sameStack = byName.find((id) => idLivesIn(id, sourceStack, ctx));
    return sameStack ?? byName[0];
  }

  // 2. this.method → ClassName.method
  if (target.startsWith("this.")) {
    const methodPart = target.slice(5);
    const simple = methodPart.includes(".") ? methodPart.split(".").pop()! : methodPart;
    for (const n of ctx.allNodes) {
      if (n.path === sourceFilePath && n.name.endsWith(`.${simple}`)) return n.id;
    }
    for (const n of ctx.allNodes) {
      if (n.name.endsWith(`.${simple}`) && n.path?.startsWith(sourceDir)) return n.id;
    }
  }

  // 3. obj.method → 同 stack の obj
  if (target.includes(".") && !target.startsWith("/") && !target.startsWith(FIRESTORE_PREFIX)) {
    const obj = target.split(".")[0];
    const byObj = ctx.nameToIds.get(obj);
    if (byObj?.length) {
      const sameStack = byObj.find((id) => idLivesIn(id, sourceStack, ctx));
      if (sameStack) return sameStack;
      if (byObj.length === 1) return byObj[0];
    }
  }

  // 4. qualified_name 末尾一致
  let fallback: string | null = null;
  for (const n of ctx.allNodes) {
    if (n.qualifiedName.endsWith(`:${target}`)) {
      if (n.qualifiedName.includes(sourceStack)) return n.id;
      fallback ??= n.id;
    }
  }
  if (fallback) return fallback;

  // 5. 大小無視 name 一致
  let partial: string | null = null;
  for (const n of ctx.allNodes) {
    if (n.name === target || n.name.toLowerCase() === target.toLowerCase()) {
      if (n.qualifiedName.includes(sourceStack)) return n.id;
      partial ??= n.id;
    }
  }
  if (partial) return partial;

  // 6. ハイフン区切り
  const hyphenIdx = target.lastIndexOf("-");
  if (hyphenIdx > 0) {
    const prefix = target.slice(0, hyphenIdx);
    const suffix = target.slice(hyphenIdx + 1);
    for (const n of ctx.allNodes) {
      if (n.name === suffix && n.qualifiedName.includes(`/${prefix}/`)) return n.id;
    }
  }

  // 7. stub
  return stubNodeId(target);
}

/** @graph-connects none */
function idLivesIn(id: string, sourceStack: string, ctx: ResolveContext): boolean {
  const node = ctx.allNodes.find((n) => n.id === id);
  return Boolean(node?.qualifiedName.includes(sourceStack));
}

/** generateExplicitEdges の戻り値 */
export interface ExplicitEdgeResult {
  edges: EdgeInput[];
  /** 解決できなかった target に対して新規生成された stub NodeInput 群 */
  stubNodes: NodeInput[];
}

/**
 * 全 ParsedExport の `@graph-connects` から explicit edges + stub nodes を生成。
 *
 * @graph-connects none
 */
export function generateExplicitEdges(
  exports: ParsedExport[],
  resolverNodes: ResolverNode[],
): ExplicitEdgeResult {
  const ctx: ResolveContext = {
    qualifiedToId: new Map(resolverNodes.map((n) => [n.qualifiedName, n.id])),
    nameToIds: new Map(),
    allNodes: resolverNodes,
  };
  for (const n of resolverNodes) {
    const list = ctx.nameToIds.get(n.name) ?? [];
    list.push(n.id);
    ctx.nameToIds.set(n.name, list);
  }

  const edges: EdgeInput[] = [];
  const stubNodes: NodeInput[] = [];
  const stubIds = new Set<string>();
  const knownIds = new Set(resolverNodes.map((n) => n.id));

  for (const exp of exports) {
    for (const conn of exp.tags.connects) {
      if (conn.target === "none") continue;
      const sourceId = symbolNodeId(exp.filePath, exp.name);
      const targetId = resolveTarget(conn.target, exp.filePath, ctx);

      edges.push({
        edge_table: "product_graph_edges",
        edge_type: conn.relationship,
        src_kind: "product_graph_nodes",
        src_id: sourceId,
        tgt_kind: "product_graph_nodes",
        tgt_id: targetId,
        via: conn.via,
        properties: {
          cardinality: conn.cardinality,
          description: conn.description,
        },
      });

      if (!knownIds.has(targetId) && !stubIds.has(targetId)) {
        stubIds.add(targetId);
        const nodeType = inferNodeType(conn.target);
        stubNodes.push({
          kind: "product_graph_nodes",
          id: targetId,
          fields: {
            node_id: targetId,
            node_type: nodeType,
            name: conn.target,
            qualified_name: conn.target,
            path: null,
            description: `${nodeType}: ${conn.target} — ${conn.description}`,
            stack: null,
            domain: null,
          },
          body_summary: `${nodeType}: ${conn.target} — ${conn.description}`,
          metadata: { external: true, source: "code-stub" },
        });
      }
    }
  }
  return { edges, stubNodes };
}
