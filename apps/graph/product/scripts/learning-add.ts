/**
 * learnings table への直接 insert CLI。decisions と並列だが、cross-session に効く insight
 * (再利用可能な原則 / 適用ルール) 用。
 *
 * 実行例:
 *   pnpm learning:add --insight="post 候補出す段階で like vs reply の triage を先に判定" \
 *     --context="5/4 で reply / quote draft 全部却下された後の振り返り" \
 *     --domain=x-engagement \
 *     --applicability="engagement 候補リスト出す前の triage 段階" \
 *     --slug=x-triage-like-vs-reply
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business cross-session に効く insight を learnings テーブル + time anchor edges に直接書き込む CLI entry。同じ insight を複数 session で再発見しないように durable な store に置く write 経路
 * @graph-connects bigquery [writes_to] learnings / time_buckets / personal_edges
 * @graph-connects vertex-ai [calls] body_summary を gemini-embedding-2 で embedding
 */

import { embedBatch, EMBEDDING_MODEL } from "@self/embedding";
import { mergeRows } from "../src/migrate/common/bq-merge.js";
import { deterministicEdgeId } from "../src/migrate/common/id.js";
import { buildLearningNodes, parseLearningArgs } from "../src/migrate/common/learning.js";
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
 * @graph-connects bigquery [writes_to] learnings + bucket cascade
 * @graph-connects vertex-ai [calls] body_summary embedding
 */
async function main(): Promise<void> {
  const args = parseLearningArgs(process.argv.slice(2));
  const { nodes, edges } = buildLearningNodes(args);

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
