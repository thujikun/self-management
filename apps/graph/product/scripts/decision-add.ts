/**
 * decisions table への直接 insert CLI。x-log と並列の write 経路。
 *
 * 実行例:
 *   pnpm decision:add --title="X activity を BQ structured table に移す" \
 *     --rationale="md hypertrophy 防止、構造化 record で graph search 可能化" \
 *     --tags=infra,logging --slug=x-activity-bq-migration
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business 個別の判断ログを decisions テーブル + time anchor edges に直接書き込む CLI entry。md log 経由を介さず BQ に到達させて、判断履歴の semantic search を可能化する write 経路
 * @graph-connects bigquery [writes_to] decisions / time_buckets / personal_edges
 * @graph-connects vertex-ai [calls] body_summary を gemini-embedding-2 で embedding
 */

import { embedBatch, EMBEDDING_MODEL } from "@self/embedding";
import { mergeRows } from "../src/migrate/common/bq-merge.js";
import { buildDecisionNodes, parseDecisionArgs } from "../src/migrate/common/decision.js";
import { deterministicEdgeId } from "../src/migrate/common/id.js";
import type { EdgeInput, NodeInput } from "../src/migrate/common/types.js";

/** @graph-connects none */
function nodeToRow(node: NodeInput): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    ...node.fields,
    metadata: node.metadata ?? null,
    embedding: (node.fields.embedding as number[] | undefined) ?? [],
    embedding_model: node.fields.embedding_model ?? null,
    first_seen_at: node.first_seen_at ?? now,
    updated_at: now,
  };
}

/** @graph-connects none */
function edgeToRow(edge: EdgeInput): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    edge_id: deterministicEdgeId(
      edge.edge_type,
      edge.src_kind,
      edge.src_id,
      edge.tgt_kind,
      edge.tgt_id,
    ),
    edge_type: edge.edge_type,
    src_kind: edge.src_kind,
    src_id: edge.src_id,
    tgt_kind: edge.tgt_kind,
    tgt_id: edge.tgt_id,
    weight: edge.weight ?? null,
    properties: edge.properties ?? null,
    created_at: edge.created_at ?? now,
  };
}

/**
 * @graph-connects bigquery [writes_to] decisions + bucket cascade
 * @graph-connects vertex-ai [calls] body_summary embedding
 */
async function main(): Promise<void> {
  const args = parseDecisionArgs(process.argv.slice(2));
  const { nodes, edges } = buildDecisionNodes(args);

  const needsEmbed = nodes.filter((n) => n.body_summary && n.body_summary.trim().length > 0);
  if (!args.noEmbed && needsEmbed.length > 0) {
    const vecs = await embedBatch(needsEmbed.map((n) => n.body_summary!));
    for (let i = 0; i < needsEmbed.length; i++) {
      needsEmbed[i].fields.embedding = vecs[i];
      needsEmbed[i].fields.embedding_model = EMBEDDING_MODEL;
    }
  }

  if (args.dryRun) {
    console.log(JSON.stringify({ nodes, edges }, null, 2));
    return;
  }

  const rowsByTable = new Map<string, Array<Record<string, unknown>>>();
  for (const n of nodes) {
    const arr = rowsByTable.get(n.kind) ?? [];
    arr.push(nodeToRow(n));
    rowsByTable.set(n.kind, arr);
  }
  for (const [tableName, rows] of rowsByTable) {
    const { merged } = await mergeRows(tableName, rows);
    console.log(`✓ merged ${merged} rows into ${tableName}`);
  }

  const edgeRows = edges.map((e) => edgeToRow(e));
  const { merged: edgeMerged } = await mergeRows("personal_edges", edgeRows);
  console.log(`✓ merged ${edgeMerged} edges into personal_edges`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
