/**
 * chrome mcp で取った X scrape data を adapter 経由で ParseResult 化 → BQ MERGE。
 *
 * usage (search kind, Phase 5b):
 *   pnpm graph:ingest-scrape -- \
 *     --kind=search \
 *     --input=/tmp/tweets.json \
 *     --article-source=zenn \
 *     --article-external-id=550620 \
 *     --raw-query=2731787582881a \
 *     [--no-embed] [--dry-run]
 *
 * input JSON は SearchScrapeTweet 配列 (chrome mcp 経由で DOM から抽出した tweet 配列)。
 * CLI が articleContentId を deterministicId で計算して SearchScrapeData を組み立て、
 * adapter に渡す → 既存 migrate orchestrator と同じ流れで dedupe + embedding + mergeRows。
 *
 * 旧 I/F (`{graphqlJson:..., context:...}` ScrapeContext) も `--raw-context` flag で
 * 動く (retweets / quotes 等で GraphQL JSON を直接食わせる将来用)。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business chrome scraper の ingest entry。input JSON + CLI 引数から
 * ScrapeContext を組み立て adapter に流して BQ MERGE。search kind では tweet 配列
 * + articleContentId/rawQuery を別引数で指定する運用 mode を提供
 * @graph-connects bigquery [writes_to] adapter が返す ParseResult を MERGE
 */

import { readFileSync } from "node:fs";
import { embedBatch, EMBEDDING_MODEL } from "@self/embedding";
import { createLogger, initOtel, shutdownOtel, withSpan } from "@self/otel";
import { mergeRows } from "../src/migrate/common/bq-merge.js";
import { deterministicEdgeId, deterministicId } from "../src/migrate/common/id.js";
import type { EdgeInput, NodeInput } from "../src/migrate/common/types.js";
import { dispatchScrape } from "../src/migrate/sources/x-scrape/dispatcher.js";
import type {
  ScrapeContext,
  ScrapeKind,
  SearchScrapeData,
  SearchScrapeTweet,
} from "../src/migrate/sources/x-scrape/types.js";

/** @graph-connects opentelemetry [calls] graph-ingest-scrape として OTel 起動 */
const log = createLogger("graph-ingest-scrape");

interface CliArgs {
  kind: ScrapeKind;
  input: string;
  noEmbed: boolean;
  dryRun: boolean;
  /** search 専用: 検索対象記事の source ("zenn" | "devto" 等) */
  articleSource: string | null;
  /** search 専用: 検索対象記事の external_id */
  articleExternalId: string | null;
  /** search 専用: X 検索 raw query */
  rawQuery: string | null;
  /** 旧 I/F: input を ScrapeContext (graphqlJson + context) としてそのまま食う */
  rawContext: boolean;
}

/** @graph-connects none */
export function parseArgs(argv: string[] = process.argv.slice(2)): CliArgs {
  const args = new Set(argv);
  const get = (prefix: string): string | null =>
    [...args].find((a) => a.startsWith(prefix))?.slice(prefix.length) ?? null;
  const kindArg = get("--kind=");
  const inputArg = get("--input=");
  if (!kindArg || !["search", "retweets", "quotes"].includes(kindArg)) {
    throw new Error(`--kind={search|retweets|quotes} required (got: ${kindArg ?? "none"})`);
  }
  if (!inputArg) {
    throw new Error("--input=/path/to/scrape.json required");
  }
  const cli: CliArgs = {
    kind: kindArg as ScrapeKind,
    input: inputArg,
    noEmbed: args.has("--no-embed"),
    dryRun: args.has("--dry-run"),
    articleSource: get("--article-source="),
    articleExternalId: get("--article-external-id="),
    rawQuery: get("--raw-query="),
    rawContext: args.has("--raw-context"),
  };
  if (cli.kind === "search" && !cli.rawContext) {
    if (!cli.articleSource || !cli.articleExternalId || !cli.rawQuery) {
      throw new Error(
        "search kind requires --article-source / --article-external-id / --raw-query (or pass --raw-context to load full ScrapeContext from --input)",
      );
    }
  }
  return cli;
}

/**
 * CLI 引数 + input JSON から ScrapeContext を組み立てる。`--raw-context` 時は input
 * を ScrapeContext そのものとして読み、そうでなければ search 用に SearchScrapeData
 * を組み立てる。
 *
 * @graph-connects none
 */
export function buildScrapeContext(cli: CliArgs, raw: string): ScrapeContext {
  if (cli.rawContext) {
    return JSON.parse(raw) as ScrapeContext;
  }
  if (cli.kind !== "search") {
    throw new Error(
      `kind=${cli.kind} requires --raw-context (pre-Phase-5c kinds use raw ScrapeContext input)`,
    );
  }
  const tweets = JSON.parse(raw) as SearchScrapeTweet[];
  if (!Array.isArray(tweets)) {
    throw new Error("search input must be a JSON array of SearchScrapeTweet");
  }
  const articleContentId = deterministicId(cli.articleSource!, cli.articleExternalId!);
  const data: SearchScrapeData = {
    rawQuery: cli.rawQuery!,
    articleContentId,
    tweets,
  };
  return { graphqlJson: data };
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
    body_summary: node.body_summary ?? node.fields.body_summary ?? null,
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
  const cli = parseArgs();
  const { kind, input, noEmbed, dryRun } = cli;
  log.info({ kind, input, noEmbed, dryRun }, "ingest-scrape start");

  const raw = readFileSync(input, "utf8");
  const ctx = buildScrapeContext(cli, raw);
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
    const r = await withSpan("ingest-scrape.bq.merge.nodes", { table, rows: rows.length }, () =>
      mergeRows(table, rows),
    );
    log.info({ table, merged: r.merged }, "merged nodes");
  }
  for (const [table, edges] of edgesByTable) {
    const rows = edges.map(edgeToRow);
    const r = await withSpan("ingest-scrape.bq.merge.edges", { table, rows: rows.length }, () =>
      mergeRows(table, rows),
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
