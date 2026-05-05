/**
 * `get_node` MCP tool。
 *
 * (kind, id) で 1 つの node を読み出し、embedding column は除外して返す。
 * 同時に「この node を src/tgt に持つ edge」も最大 50 件付ける (edges を 3 table から)。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business 単一 node の詳細取得 MCP tool。type-specific column 全部 + 接続 edge (in/out) を含めて返すことで「この node の context」を 1 reply で得られる
 * @graph-connects bigquery [reads_from] 単一 node + edge join
 */

import { PK_COLUMN, PROJECT_ID, query, type NodeTable } from "../bq.js";

export interface GetNodeInput {
  kind: NodeTable;
  id: string;
}

export interface ConnectedEdge {
  edge_table: "personal_edges" | "release_edges" | "product_graph_edges";
  edge_type: string;
  direction: "out" | "in";
  src_kind: string;
  src_id: string;
  tgt_kind: string;
  tgt_id: string;
  properties: Record<string, unknown> | null;
}

export interface NodeDetail {
  kind: NodeTable;
  row: Record<string, unknown>;
  edges: ConnectedEdge[];
}

/**
 * 指定 node を取得し、connected edges を 3 つの edge table から union 取得。
 *
 * @graph-connects bigquery [reads_from] node + 接続 edge
 */
export async function getNode(input: GetNodeInput): Promise<NodeDetail | null> {
  const pk = PK_COLUMN[input.kind];
  const nodeRows = await query<Record<string, unknown>>(
    `SELECT * EXCEPT (embedding) FROM \`${PROJECT_ID}.ryan.${input.kind}\` WHERE ${pk} = @id LIMIT 1`,
    { id: input.id },
  );
  if (nodeRows.length === 0) return null;

  // personal_edges / release_edges は src_kind/src_id + tgt_kind/tgt_id。
  // product_graph_edges は src_node_id / tgt_node_id 形式。前者だけ wildcard で UNION。
  const edgesSql = `
    SELECT 'personal_edges' AS edge_table, edge_type, 'out' AS direction,
           src_kind, src_id, tgt_kind, tgt_id, properties
    FROM \`${PROJECT_ID}.ryan.personal_edges\`
    WHERE src_kind = @kind AND src_id = @id
    UNION ALL
    SELECT 'personal_edges', edge_type, 'in',
           src_kind, src_id, tgt_kind, tgt_id, properties
    FROM \`${PROJECT_ID}.ryan.personal_edges\`
    WHERE tgt_kind = @kind AND tgt_id = @id
    UNION ALL
    SELECT 'release_edges', edge_type, 'out',
           src_kind, src_id, tgt_kind, tgt_id, properties
    FROM \`${PROJECT_ID}.ryan.release_edges\`
    WHERE src_kind = @kind AND src_id = @id
    UNION ALL
    SELECT 'release_edges', edge_type, 'in',
           src_kind, src_id, tgt_kind, tgt_id, properties
    FROM \`${PROJECT_ID}.ryan.release_edges\`
    WHERE tgt_kind = @kind AND tgt_id = @id
    LIMIT 50
  `;
  const edges = await query<ConnectedEdge>(edgesSql, { kind: input.kind, id: input.id });

  return { kind: input.kind, row: nodeRows[0], edges };
}
