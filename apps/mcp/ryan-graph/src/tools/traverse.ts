/**
 * `traverse` MCP tool。
 *
 * 起点 node から edge 系統で BFS。最大 depth、edge_type / direction で絞り込み可能。
 * 1 hop あたり 100 件 cap、最大 depth 3 で防爆。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business 起点 node から graph を BFS で広げる MCP tool。「この decision に紐付く全 thread」「この topic に tagged された content 群」のような cross-table の影響範囲を 1 query で取れる
 * @graph-connects bigquery [reads_from] edges 表を多 hop に traverse
 */

import { PROJECT_ID, query } from "../bq.js";

export interface TraverseInput {
  kind: string;
  id: string;
  edgeType?: string;
  direction?: "out" | "in" | "both";
  maxDepth?: number;
}

export interface TraverseEdge {
  edge_table: string;
  edge_type: string;
  src_kind: string;
  src_id: string;
  tgt_kind: string;
  tgt_id: string;
  depth: number;
}

/**
 * 1 hop 分の edges を取る。direction で 出向 / 入向 / 双方向。
 * 3 graph 全部 (personal_edges / release_edges / product_graph_edges) を UNION して
 * cross-graph traversal を可能にする。
 *
 * @graph-connects bigquery [reads_from] personal_edges / release_edges / product_graph_edges を 1 hop 取得
 */
export async function fetchOneHop(
  fromKind: string,
  fromId: string,
  edgeType: string | undefined,
  direction: "out" | "in" | "both",
): Promise<Array<Omit<TraverseEdge, "depth">>> {
  const cond = edgeType ? "AND edge_type = @et" : "";
  const params: Record<string, unknown> = { k: fromKind, i: fromId };
  if (edgeType) params.et = edgeType;

  const parts: string[] = [];
  if (direction === "out" || direction === "both") {
    parts.push(`
      SELECT 'personal_edges' AS edge_table, edge_type, src_kind, src_id, tgt_kind, tgt_id
      FROM \`${PROJECT_ID}.ryan.personal_edges\`
      WHERE src_kind = @k AND src_id = @i ${cond}
      UNION ALL
      SELECT 'release_edges', edge_type, src_kind, src_id, tgt_kind, tgt_id
      FROM \`${PROJECT_ID}.ryan.release_edges\`
      WHERE src_kind = @k AND src_id = @i ${cond}
      UNION ALL
      SELECT 'product_graph_edges', edge_type, src_kind, src_id, tgt_kind, tgt_id
      FROM \`${PROJECT_ID}.ryan.product_graph_edges\`
      WHERE src_kind = @k AND src_id = @i ${cond}
    `);
  }
  if (direction === "in" || direction === "both") {
    parts.push(`
      SELECT 'personal_edges' AS edge_table, edge_type, src_kind, src_id, tgt_kind, tgt_id
      FROM \`${PROJECT_ID}.ryan.personal_edges\`
      WHERE tgt_kind = @k AND tgt_id = @i ${cond}
      UNION ALL
      SELECT 'release_edges', edge_type, src_kind, src_id, tgt_kind, tgt_id
      FROM \`${PROJECT_ID}.ryan.release_edges\`
      WHERE tgt_kind = @k AND tgt_id = @i ${cond}
      UNION ALL
      SELECT 'product_graph_edges', edge_type, src_kind, src_id, tgt_kind, tgt_id
      FROM \`${PROJECT_ID}.ryan.product_graph_edges\`
      WHERE tgt_kind = @k AND tgt_id = @i ${cond}
    `);
  }
  const sql = `${parts.join("\n      UNION ALL\n")}\n      LIMIT 100`;
  return query<Omit<TraverseEdge, "depth">>(sql, params);
}

/**
 * BFS。max_depth 上限 3、各 hop 100 件 cap、cycle 防止 (visited set)。
 *
 * @graph-connects bigquery [reads_from] graph を BFS で展開
 */
export async function traverse(input: TraverseInput): Promise<TraverseEdge[]> {
  const direction = input.direction ?? "both";
  const maxDepth = Math.min(input.maxDepth ?? 2, 3);
  const visited = new Set<string>([`${input.kind}:${input.id}`]);
  const out: TraverseEdge[] = [];
  let frontier: Array<{ kind: string; id: string }> = [{ kind: input.kind, id: input.id }];

  for (let depth = 1; depth <= maxDepth; depth++) {
    const nextFrontier: Array<{ kind: string; id: string }> = [];
    for (const f of frontier) {
      const edges = await fetchOneHop(f.kind, f.id, input.edgeType, direction);
      for (const e of edges) {
        out.push({ ...e, depth });
        const otherKind = f.kind === e.src_kind && f.id === e.src_id ? e.tgt_kind : e.src_kind;
        const otherId = f.kind === e.src_kind && f.id === e.src_id ? e.tgt_id : e.src_id;
        const key = `${otherKind}:${otherId}`;
        if (!visited.has(key)) {
          visited.add(key);
          nextFrontier.push({ kind: otherKind, id: otherId });
        }
      }
    }
    if (nextFrontier.length === 0) break;
    frontier = nextFrontier;
  }
  return out;
}
