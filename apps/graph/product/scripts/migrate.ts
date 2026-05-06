/**
 * P2 migration orchestrator。
 *
 * usage:
 *   pnpm graph:migrate                        # 全 source、書き込みあり
 *   pnpm graph:migrate -- --dry-run           # parse + 統計のみ、BQ には書かない
 *   pnpm graph:migrate -- --source=memory     # 単一 source のみ
 *   pnpm graph:migrate -- --no-embed          # embedding 生成を skip
 *   pnpm graph:migrate -- --source=x --incremental    # since_id-based 真 incremental
 *                                                     # (own/mention は新規のみ、liked/bookmark は最新 100 件)
 *                                                     # Free tier 持続可能 (~30-150 reads/日)
 *   pnpm graph:migrate -- --source=x --max-pages=5    # X のページ数を明示指定 (incremental と排他)
 *   pnpm graph:migrate -- --source=x --with-back-refs --back-refs-max=50
 *                                                     # 自分の tweet への外部 engagement
 *                                                     # (retweet/quote of me) を fetch (OAuth2 必須)
 *
 * フロー:
 * 1. 各 parser を呼び出し ParseResult を集める
 * 2. body_summary は (このスクリプト実行時点で) parser の metadata.body_md or fields.body_md
 *    から派生していない → migration runner 側で「summary 必須」な node には
 *    summary が無い旨を warn して null のまま登録 (後で別パスで埋める運用)。
 *    今回は parser 側で必要なら body_summary を入れる前提とし、orchestrator では空の
 *    まま BQ に流す。
 * 3. body_summary が non-null な node は gemini-embedding-2 で embedding 生成
 * 4. 各 table 単位で MERGE (upsert)
 * 5. edges も deterministic edge_id で MERGE
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business 4 source parser を束ね、dedupe → embedding 付与 → BQ MERGE までを 1 entry でこなす migration オーケストレータ。P2 (markdown → graph) の本体
 * @graph-connects bigquery [writes_to] 全 node/edge テーブルへ idempotent UPSERT で書き込み
 */

import { embedBatch, EMBEDDING_MODEL } from "@self/embedding";
import { createLogger, initOtel, shutdownOtel, withSpan } from "@self/otel";
import { deterministicEdgeId } from "../src/migrate/common/id.js";
import { mergeRows } from "../src/migrate/common/bq-merge.js";
import type { EdgeInput, NodeInput, ParseResult } from "../src/migrate/common/types.js";
import { parseOperationsLog } from "../src/migrate/sources/operations-log.js";
import { parseThreads } from "../src/migrate/sources/threads.js";
import { parseStrategyDoc } from "../src/migrate/sources/strategy.js";
import { parseMemory } from "../src/migrate/sources/memory.js";
import { parseX } from "../src/migrate/sources/x/index.js";
import {
  buildUrlReferenceEdges,
  collectTcoUrls,
  loadUrlIndexFromBq,
  resolveTcoUrls,
} from "../src/migrate/sources/x/url-references.js";
import { parseCode } from "../src/migrate/sources/code/index.js";
import { parseZenn } from "../src/migrate/sources/zenn.js";
import { parseDevto } from "../src/migrate/sources/devto.js";

/** @graph-connects opentelemetry [calls] graph-migrate サービスとして OTel 起動 + structured logger */
const log = createLogger("graph-migrate");

/** @graph-connects none */
const args = new Set(process.argv.slice(2));
/** @graph-connects none */
const dryRun = args.has("--dry-run");
/** @graph-connects none */
const noEmbed = args.has("--no-embed");
/** @graph-connects none */
const incremental = args.has("--incremental");
/** @graph-connects none */
const withBackRefs = args.has("--with-back-refs");
/** @graph-connects none */
const backRefsMaxArg = [...args].find((a) => a.startsWith("--back-refs-max="))?.slice("--back-refs-max=".length);
/** @graph-connects none */
const backRefsMax = backRefsMaxArg ? Number(backRefsMaxArg) : undefined;
/** @graph-connects none */
const sourceFilter = [...args].find((a) => a.startsWith("--source="))?.slice("--source=".length);
/** @graph-connects none */
const maxPagesArg = [...args].find((a) => a.startsWith("--max-pages="))?.slice("--max-pages=".length);
/** @graph-connects none */
const maxPages = maxPagesArg ? Number(maxPagesArg) : undefined;

type SourceName = "operations-log" | "threads" | "strategy" | "memory" | "x" | "code" | "zenn" | "devto";
/** @graph-connects none */
const ALL_SOURCES: SourceName[] = [
  "operations-log",
  "threads",
  "strategy",
  "memory",
  "x",
  "code",
  "zenn",
  "devto",
];

/** @graph-connects none */
async function runParsers(): Promise<ParseResult[]> {
  const targets: SourceName[] = sourceFilter
    ? (ALL_SOURCES.filter((s) => s === sourceFilter) as SourceName[])
    : ALL_SOURCES;
  if (targets.length === 0) {
    throw new Error(`Unknown --source=${sourceFilter}. Valid: ${ALL_SOURCES.join(", ")}`);
  }
  const results: ParseResult[] = [];
  for (const t of targets) {
    const r = await withSpan(
      `migrate.parse.${t}`,
      { source: t },
      () =>
        ({
          "operations-log": parseOperationsLog,
          threads: parseThreads,
          strategy: parseStrategyDoc,
          memory: parseMemory,
          x: () =>
            parseX(undefined, {
              ...(maxPages !== undefined ? { maxPages } : {}),
              ...(incremental ? { incremental: true } : {}),
              ...(withBackRefs ? { skipBackReferences: false } : {}),
              ...(backRefsMax !== undefined ? { backRefsMaxTweets: backRefsMax } : {}),
            }),
          code: () => parseCode(),
          zenn: () => parseZenn(),
          devto: () => parseDevto(),
        })[t](),
    );
    log.info({ source: t, nodes: r.nodes.length, edges: r.edges.length }, "parsed source");
    results.push(r);
  }
  return results;
}

/**
 * 全 parse 結果を node-table 単位 + edge-table 単位に集約。
 * 重複 ID は最後勝ち (parser 順 = 戦略 + 順序で決まる)。
 *
 * @graph-connects none
 */
function dedupeAndGroup(results: ParseResult[]) {
  const nodesByTable = new Map<string, Map<string, NodeInput>>();
  const edgesByTable = new Map<string, Map<string, EdgeInput>>();

  for (const r of results) {
    for (const n of r.nodes) {
      let tableMap = nodesByTable.get(n.kind);
      if (!tableMap) {
        tableMap = new Map();
        nodesByTable.set(n.kind, tableMap);
      }
      tableMap.set(n.id, n);
    }
    for (const e of r.edges) {
      const id = deterministicEdgeId(e.edge_type, e.src_kind, e.src_id, e.tgt_kind, e.tgt_id);
      let tableMap = edgesByTable.get(e.edge_table);
      if (!tableMap) {
        tableMap = new Map();
        edgesByTable.set(e.edge_table, tableMap);
      }
      tableMap.set(id, e);
    }
  }
  return { nodesByTable, edgesByTable };
}

/**
 * embedding 必要な node に対し batch embedding を実行 (250 chunk)。
 * body_summary が null/empty の node は skip。
 *
 * @graph-connects vertex-ai [calls] gemini-embedding-2 を呼んで body_summary を embedding 化
 */
async function attachEmbeddings(nodesByTable: Map<string, Map<string, NodeInput>>) {
  if (noEmbed) {
    log.info("--no-embed: skipping embedding generation");
    return;
  }
  const all: Array<{ tableName: string; node: NodeInput }> = [];
  for (const [tableName, m] of nodesByTable) {
    for (const node of m.values()) {
      if (node.body_summary && node.body_summary.trim().length > 0) {
        all.push({ tableName, node });
      }
    }
  }
  if (all.length === 0) {
    log.info("embedding: no nodes with body_summary");
    return;
  }
  log.info({ count: all.length, model: EMBEDDING_MODEL }, "embedding start");
  const CHUNK = 100;
  for (let i = 0; i < all.length; i += CHUNK) {
    const chunk = all.slice(i, i + CHUNK);
    const texts = chunk.map((c) => c.node.body_summary!);
    const vecs = await withSpan(
      "migrate.embed.batch",
      { batch_size: chunk.length, offset: i },
      () => embedBatch(texts),
    );
    for (let j = 0; j < chunk.length; j++) {
      const fieldKey = "embedding";
      const modelKey = "embedding_model";
      chunk[j].node.fields[fieldKey] = vecs[j];
      chunk[j].node.fields[modelKey] = EMBEDDING_MODEL;
    }
    log.info({ done: Math.min(i + CHUNK, all.length), total: all.length }, "embedding progress");
  }
}

/**
 * NodeInput を BQ row 形式 (Record<string, unknown>) に展開。
 *
 * @graph-connects none
 */
function nodeToRow(node: NodeInput): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    ...node.fields,
    body_summary: node.body_summary ?? (node.fields.body_summary ?? null),
    metadata: node.metadata ?? null,
    embedding: (node.fields.embedding as number[] | undefined) ?? [], // REPEATED: 空配列 OK、null は不可
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
  const baseRow = {
    edge_id: id,
    edge_type: edge.edge_type,
    properties: edge.properties ?? null,
    created_at: edge.created_at ?? now,
  };
  if (edge.edge_table === "personal_edges") {
    return {
      ...baseRow,
      src_kind: edge.src_kind,
      src_id: edge.src_id,
      tgt_kind: edge.tgt_kind,
      tgt_id: edge.tgt_id,
      weight: edge.weight ?? null,
    };
  }
  if (edge.edge_table === "release_edges") {
    return {
      ...baseRow,
      src_kind: edge.src_kind,
      src_id: edge.src_id,
      tgt_kind: edge.tgt_kind,
      tgt_id: edge.tgt_id,
    };
  }
  // product_graph_edges
  return {
    ...baseRow,
    src_node_id: edge.src_id,
    tgt_node_id: edge.tgt_id,
    via: edge.via ?? null,
  };
}

/**
 * orchestrator entry。parse → dedupe → embedding → MERGE。
 *
 * @graph-connects bigquery [writes_to] 全 node/edge テーブルへ idempotent UPSERT
 */
async function main() {
  await initOtel({ serviceName: "graph-migrate" });
  log.info({ dryRun, noEmbed, sourceFilter: sourceFilter ?? "all" }, "migrate start");

  const results = await runParsers();
  const { nodesByTable, edgesByTable } = dedupeAndGroup(results);

  // Phase 4i: 既存 BQ contents の URL を含めた index で X tweet body の URL → article
  // への references edge を生成 (--source=x incremental でも他 source の article と
  // 結べるように)。dry-run でも edge 数だけは出す。
  const allContents = [...(nodesByTable.get("contents") ?? new Map()).values()];
  let urlEdgeCount = 0;
  let tcoResolvedCount = 0;
  if (allContents.length > 0) {
    try {
      const externalIndex = await loadUrlIndexFromBq();
      const tcoUrls = collectTcoUrls(allContents);
      const tcoMap = tcoUrls.length > 0 ? await resolveTcoUrls(tcoUrls) : new Map();
      tcoResolvedCount = tcoMap.size;
      const urlEdges = buildUrlReferenceEdges(allContents, externalIndex, tcoMap);
      const personalEdges = edgesByTable.get("personal_edges") ?? new Map();
      for (const e of urlEdges) {
        const id = deterministicEdgeId(e.edge_type, e.src_kind, e.src_id, e.tgt_kind, e.tgt_id);
        if (!personalEdges.has(id)) personalEdges.set(id, e);
      }
      edgesByTable.set("personal_edges", personalEdges);
      urlEdgeCount = urlEdges.length;
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "url-references: skipped",
      );
    }
  }
  log.info({ urlEdges: urlEdgeCount, tcoResolved: tcoResolvedCount }, "url references built");

  for (const [t, m] of nodesByTable) log.info({ table: t, count: m.size }, "nodes summary");
  for (const [t, m] of edgesByTable) log.info({ table: t, count: m.size }, "edges summary");

  if (dryRun) {
    let withSummary = 0;
    let withoutSummary = 0;
    for (const m of nodesByTable.values()) {
      for (const n of m.values()) {
        if (n.body_summary && n.body_summary.trim().length > 0) withSummary++;
        else withoutSummary++;
      }
    }
    log.info({ withSummary, withoutSummary }, "dry-run: skipping embedding + BQ writes");
    return;
  }

  await attachEmbeddings(nodesByTable);

  for (const [tableName, m] of nodesByTable) {
    const rows = [...m.values()].map(nodeToRow);
    const result = await withSpan(
      "migrate.bq.merge.nodes",
      { table: tableName, rows: rows.length },
      () => mergeRows(tableName, rows),
    );
    log.info({ table: tableName, merged: result.merged }, "merged nodes");
  }
  for (const [tableName, m] of edgesByTable) {
    const rows = [...m.values()].map(edgeToRow);
    const result = await withSpan(
      "migrate.bq.merge.edges",
      { table: tableName, rows: rows.length },
      () => mergeRows(tableName, rows),
    );
    log.info({ table: tableName, merged: result.merged }, "merged edges");
  }
  log.info("migration done");
}

main()
  .catch((e) => {
    log.error({ err: e instanceof Error ? e.message : String(e) }, "migration failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await shutdownOtel();
  });
