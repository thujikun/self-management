/**
 * code parser orchestrator: `parseCode()` で mono-repo 配下の `@graph-*` 付き宣言を
 * `product_graph_nodes` + `product_graph_edges` に展開する。
 *
 * 流れ:
 *  1. `parseJSDocExports()` で全 ParsedExport を収集
 *  2. ParsedExport → product_graph_nodes 用 NodeInput を生成 (description は embedding 用に整形)
 *  3. `generateExplicitEdges()` で edge + 未解決 stub を生成
 *  4. ParseResult に統合して返す (migrate.ts orchestrator が consume)
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business 自リポジトリの @graph-* タグから product-graph (nodes + edges) を構築する parser entry。textForEmbedding でセマンティック検索可能、未解決 target は external stub として graph に組み入れる
 * @graph-connects filesystem [reads_from] mono-repo 配下 .ts/.tsx を ts-morph で解析
 * @graph-connects bigquery [writes_to] product_graph_nodes + product_graph_edges を構築する ParseResult を生成
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { NodeInput, ParseResult } from "../../common/types.js";
import { generateExplicitEdges, symbolNodeId, type ResolverNode } from "./edges.js";
import { parseJSDocExports, SOURCE_PATTERNS, type ParsedExport } from "./parser.js";

/** @graph-connects none */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../../../");

/**
 * embedding 入力: NodeType + name + business + domain + stack + path を改行で結合。
 *
 * @graph-connects none
 */
export function buildDescription(exp: ParsedExport): string {
  const nodeType = exp.tags.nodeType ?? "Function";
  const lines = [
    `${nodeType}: ${exp.name}`,
    exp.tags.business ? `ビジネス: ${exp.tags.business}` : null,
    exp.tags.domains.length > 0 ? `ドメイン: ${exp.tags.domains.join(", ")}` : null,
    exp.tags.stack ? `スタック: ${exp.tags.stack}` : null,
    `ファイル: ${exp.filePath}`,
  ].filter((l): l is string => l !== null);
  return lines.join("\n");
}

/**
 * 1 ParsedExport を 1 NodeInput (kind=product_graph_nodes) に変換。
 *
 * @graph-connects none
 */
export function exportToNode(exp: ParsedExport): NodeInput {
  const id = symbolNodeId(exp.filePath, exp.name);
  const description = buildDescription(exp);
  return {
    kind: "product_graph_nodes",
    id,
    fields: {
      node_id: id,
      node_type: exp.tags.nodeType ?? "Function",
      name: exp.name,
      qualified_name: `${exp.filePath}:${exp.name}`,
      path: exp.filePath,
      description,
      stack: exp.tags.stack,
      domain: exp.tags.domains[0] ?? null,
    },
    body_summary: description,
    metadata: {
      domains: exp.tags.domains,
      business: exp.tags.business,
      connects: exp.tags.connects,
      is_exported: exp.isExported,
      start_line: exp.startLine,
      end_line: exp.endLine,
    },
  };
}

/**
 * NodeInput → ResolverNode (edge resolution に最低限必要な info)。
 *
 * @graph-connects none
 */
export function nodeToResolverNode(node: NodeInput): ResolverNode {
  return {
    id: node.id,
    name: node.fields.name as string,
    qualifiedName: node.fields.qualified_name as string,
    path: (node.fields.path as string | null) ?? null,
  };
}

export interface ParseCodeOptions {
  /** repo root (default: workspace ルート) */
  cwd?: string;
  /** glob patterns (default: SOURCE_PATTERNS) */
  patterns?: string[];
}

/**
 * mono-repo 配下を走査して ParseResult を返す。
 *
 * @graph-connects filesystem [reads_from] @graph-* 付き .ts/.tsx を全部走査
 */
export async function parseCode(opts: ParseCodeOptions = {}): Promise<ParseResult> {
  const cwd = opts.cwd ?? REPO_ROOT;
  const patterns = opts.patterns ?? SOURCE_PATTERNS;
  const exports = await parseJSDocExports(cwd, patterns);
  const symbolNodes = exports.map(exportToNode);
  const resolverNodes = symbolNodes.map(nodeToResolverNode);
  const { edges, stubNodes } = generateExplicitEdges(exports, resolverNodes);
  return {
    source: "code",
    nodes: [...symbolNodes, ...stubNodes],
    edges,
  };
}
