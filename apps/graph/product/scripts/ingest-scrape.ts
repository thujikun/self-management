/**
 * chrome mcp で取った X GraphQL JSON を adapter 経由で ParseResult 化 → BQ MERGE。
 *
 * usage:
 *   pnpm graph:ingest-scrape -- --kind=search --input=/tmp/scrape.json [--no-embed] [--dry-run]
 *
 * input JSON は `{ graphqlJson: <obj>, context?: <obj> }` 形式 (= ScrapeContext)。
 * adapter が ParseResult 返す → 既存 migrate orchestrator と同じ流れで dedupe +
 * embedding + mergeRows。
 *
 * Phase 5a 時点では adapter 全部 stub なので呼んでも throw する。Phase 5b 以降で
 * 実 adapter を `registerScrapeAdapter` で差し替えると動く。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business chrome scraper の ingest entry。stdin/file から ScrapeContext JSON
 * を読み adapter 通して既存 BQ パイプラインに流す。Phase 5a は scaffolding のみ
 * @graph-connects bigquery [writes_to] adapter が返す ParseResult を MERGE
 */

import { readFileSync } from "node:fs";
import { embedBatch, EMBEDDING_MODEL } from "@self/embedding";
import { createLogger, initOtel, shutdownOtel, withSpan } from "@self/otel";
import { mergeRows } from "../src/migrate/common/bq-merge.js";
import { deterministicEdgeId } from "../src/migrate/common/id.js";
import type { EdgeInput, NodeInput } from "../src/migrate/common/types.js";
import { dispatchScrape } from "../src/migrate/sources/x-scrape/dispatcher.js";
import type { ScrapeContext, ScrapeKind } from "../src/migrate/sources/x-scrape/types.js";

/** @graph-connects opentelemetry [calls] graph-ingest-scrape として OTel 起動 */
const log = createLogger("graph-ingest-scrape");

/** @graph-connects none */
function parseArgs(): { kind: ScrapeKind; input: string; noEmbed: boolean; dryRun: boolean } {
  const args = new Set(process.argv.slice(2));
  const kindArg = [...args].find((a) => a.startsWith("--kind="))?.slice("--kind=".length);
  const inputArg = [...args].find((a) => a.startsWith("--input="))?.slice("--input=".length);
  if (!kindArg || !["search", "retweets", "quotes"].includes(kindArg)) {
    throw new Error(`--kind={search|retweets|quotes} required (got: ${kindArg ?? "none"})`);
  }
  if (!inputArg) {
    throw new Error("--input=/path/to/scrape.json required");
  }
  return {
    kind: kindArg as ScrapeKind,
    input: inputArg,
    noEmbed: args.has("--no-embed"),
    dryRun: args.has("--dry-run"),
  };
}

/** @graph-connects none */
async function attachEmbeddings(nodes: NodeInput[]): Promise<void> {
  const targets = nodes.filter((n) => n.body_summary && n.body_summary.trim().length > 0);
  if (targets.length === 0) {
    log.info("embedding: no nodes with body_summary");
    return;
  }
  const CHUNK = 100;
  log.info({ count: targets.length, model: EMBEDDING_MODEL }, "embedding start");
  for (let i = 0; i < targets.length; i += CHUNK) {
    const batch = targets.slice(i, i + CHUNK);
    const vecs = await withSpan(
      "ingest-scrape.embed.batch",
      { batch_size: batch.length, offset: i },
      () => embedBatch(batch.map((n) => n.body_summary!)),
    );
    for (let j = 0; j < batch.length; j++) {
      batch[j].fields.embedding = vecs[j];
      batch[j].fields.embedding_model = EMBEDDING_MODEL;
    }
  }
}

/** @graph-connects none */
function nodeToRow(node: NodeInput): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    ...node.fields,
    body_summary: node.body_summary ?? (node.fields.body_summary ?? null),
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

/** @graph-connects bigquery [writes_to] adapter ParseResult を MERGE */
async function main(): Promise<void> {
  await initOtel({ serviceName: "graph-ingest-scrape" });
  const { kind, input, noEmbed, dryRun } = parseArgs();
  log.info({ kind, input, noEmbed, dryRun }, "ingest-scrape start");

  const raw = readFileSync(input, "utf8");
  const ctx = JSON.parse(raw) as ScrapeContext;
  const result = await withSpan(`ingest-scrape.adapter.${kind}`, { kind }, async () =>
    dispatchScrape(kind, ctx),
  );
  log.info(
    { kind, source: result.source, nodes: result.nodes.length, edges: result.edges.length },
    "adapter parsed",
  );

  if (dryRun) {
    log.info("dry-run: skipping embedding + BQ writes");
    return;
  }

  if (!noEmbed) await attachEmbeddings(result.nodes);

  // table 別に集約
  const nodesByTable = new Map<string, NodeInput[]>();
  for (const n of result.nodes) {
    const list = nodesByTable.get(n.kind) ?? [];
    list.push(n);
    nodesByTable.set(n.kind, list);
  }
  const edgesByTable = new Map<string, EdgeInput[]>();
  for (const e of result.edges) {
    const list = edgesByTable.get(e.edge_table) ?? [];
    list.push(e);
    edgesByTable.set(e.edge_table, list);
  }

  for (const [table, nodes] of nodesByTable) {
    const rows = nodes.map(nodeToRow);
    const r = await withSpan(
      "ingest-scrape.bq.merge.nodes",
      { table, rows: rows.length },
      () => mergeRows(table, rows),
    );
    log.info({ table, merged: r.merged }, "merged nodes");
  }
  for (const [table, edges] of edgesByTable) {
    const rows = edges.map(edgeToRow);
    const r = await withSpan(
      "ingest-scrape.bq.merge.edges",
      { table, rows: rows.length },
      () => mergeRows(table, rows),
    );
    log.info({ table, merged: r.merged }, "merged edges");
  }
  log.info("ingest-scrape done");
}

main()
  .catch((e) => {
    log.error({ err: e instanceof Error ? e.message : String(e) }, "ingest-scrape failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await shutdownOtel();
  });
