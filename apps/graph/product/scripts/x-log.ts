/**
 * X engagement (post / drop / follow / unfollow / like / skip) の判断ログを
 * `engagement_decisions` table に直接 insert する CLI。
 *
 * pure logic は `src/migrate/common/engagement.ts` にあり、ここは引数 parse →
 * embedding → BQ MERGE をまとめる薄い entry。
 *
 * 実行例:
 *   pnpm x:log --action=posted --posted-post-id=2052041746444701790 \
 *     --posted-post-type=quote --target-post-id=2051659448293425342 \
 *     --target-handle=dexhorthy --target-followers=17800 \
 *     --our-text="..." --strategy-tier=reciprocation \
 *     --rationale="..."
 *
 *   pnpm x:log --action=follow --target-user-id=897875988222271488 \
 *     --target-handle=_PaperMoose_ --target-followers=1269 \
 *     --strategy-tier=tier_1 --rationale="..."
 *
 * 認証: `GOOGLE_APPLICATION_CREDENTIALS` または `gcloud auth application-default login`。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business X engagement の 1 アクションを engagement_decisions / time_buckets / personal_edges に直接書き込む CLI entry。md log の肥大化を回避し、構造化 record + embedding で graph 検索可能化する write 経路
 * @graph-connects bigquery [writes_to] engagement_decisions / time_buckets / personal_edges
 * @graph-connects vertex-ai [calls] body_summary を gemini-embedding-2 で embedding
 */

import { embedBatch, EMBEDDING_MODEL } from "@self/embedding";
import { mergeRows } from "../src/migrate/common/bq-merge.js";
import {
  buildEngagementNodes,
  parseEngagementArgs,
} from "../src/migrate/common/engagement.js";
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
  const id = deterministicEdgeId(
    edge.edge_type,
    edge.src_kind,
    edge.src_id,
    edge.tgt_kind,
    edge.tgt_id,
  );
  return {
    edge_id: id,
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
 * メイン: 引数 parse → ノード/エッジ構築 → embedding → BQ MERGE。
 *
 * @graph-connects bigquery [writes_to] engagement_decisions / time_buckets / personal_edges
 * @graph-connects vertex-ai [calls] body_summary を gemini-embedding-2 で embedding
 */
async function main(): Promise<void> {
  const args = parseEngagementArgs(process.argv.slice(2));
  const { nodes, edges } = buildEngagementNodes(args);

  const needsEmbed = nodes.filter(
    (n) => n.body_summary && n.body_summary.trim().length > 0,
  );
  if (!args.noEmbed && needsEmbed.length > 0) {
    const texts = needsEmbed.map((n) => n.body_summary!);
    const vecs = await embedBatch(texts);
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
