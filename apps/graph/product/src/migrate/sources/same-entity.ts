/**
 * `same_entity` edge ビルダー。BQ 上の embedding を利用して cross-source
 * (zenn ↔ devto 等) で似た content を翻訳ペアとして自動検出する post-processor。
 *
 * 検出ロジック: cosine similarity ≥ `simThreshold` AND `published_at` 差
 * ≤ `maxDays` の cross-source ペア。Ryan の Zenn/dev.to 翻訳ペアは
 * 同日〜数日内に publish される運用なので、sim だけでは false positive になる
 * 同テーマ別記事を `published_at` 近接で除外できる。
 *
 * default 閾値 (sim=0.73, days=2.0) は実測 (2026-05-06 時点 Zenn 6 + dev.to 7
 * 計 13 件) で翻訳 6/6 を捕捉、false positive 0 に調整した値。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business 翻訳ペア (Zenn JP ↔ dev.to EN 等) を embedding 類似度 +
 * published_at 近接で自動検出して `same_entity` edge に変換。手動 curated
 * config を不要にし、新記事追加時にも自動対応
 * @graph-connects bigquery [reads_from] contents.embedding を全件 SELECT
 */

import { BigQuery } from "@google-cloud/bigquery";
import { BQ_DATASET } from "../../schema/shared.js";
import type { EdgeInput, ParseResult } from "../common/types.js";

/** @graph-connects none */
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT ?? "ryan-self-management";
/** @graph-connects none */
const LOCATION = "asia-northeast1";

/** @graph-connects none */
export const DEFAULT_SIM_THRESHOLD = 0.73;
/** @graph-connects none */
export const DEFAULT_MAX_DAYS = 2.0;
/**
 * 翻訳/同記事の検出対象とする source 集合 (記事系のみ)。X post 等は同テーマで
 * 高 sim になっても same_entity ではないため除外。
 *
 * @graph-connects none
 */
export const DEFAULT_ELIGIBLE_SOURCES: readonly string[] = ["zenn", "devto"];

/** BQ client interface (test inject 可)。 */
export interface BqQueryClient {
  createQueryJob(req: {
    query: string;
    location: string;
  }): Promise<
    [
      { getQueryResults(): Promise<[Array<Record<string, unknown>>, ...unknown[]]> },
      ...unknown[],
    ]
  >;
}

/** 1 contents 行 (embedding + published_at 付き)。 */
export interface ContentEmbeddingRow {
  content_id: string;
  source: string;
  published_at: string;
  embedding: number[];
}

/** 同一エンティティ候補ペア。 */
export interface SameEntityPair {
  src_id: string;
  tgt_id: string;
  similarity: number;
  daysDiff: number;
}

/**
 * default BigQuery client (本番)。
 *
 * @graph-connects bigquery [reads_from] contents.embedding 取得用 client
 */
export function defaultBqClient(): BqQueryClient {
  return new BigQuery({ projectId: PROJECT_ID, location: LOCATION }) as unknown as BqQueryClient;
}

/**
 * cosine similarity (両 vector の長さは同じ前提)。NaN や 0-vector は 0 を返す。
 *
 * @graph-connects none
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * BQ から `embedding IS NOT NULL` な contents 全件を取得する。
 *
 * @graph-connects bigquery [reads_from] SELECT content_id, source, published_at, embedding
 */
export async function loadContentsWithEmbedding(
  client: BqQueryClient = defaultBqClient(),
): Promise<ContentEmbeddingRow[]> {
  const sql = `
    SELECT content_id, source, published_at, embedding
    FROM \`${PROJECT_ID}.${BQ_DATASET}.contents\`
    WHERE embedding IS NOT NULL
  `;
  const [job] = await client.createQueryJob({ query: sql, location: LOCATION });
  const [rows] = await job.getQueryResults();
  const out: ContentEmbeddingRow[] = [];
  for (const row of rows) {
    const id = row.content_id;
    const source = row.source;
    const pub = row.published_at;
    const emb = row.embedding;
    if (typeof id !== "string" || typeof source !== "string") continue;
    const pubStr = typeof pub === "string" ? pub : (pub as { value?: string } | null)?.value;
    if (typeof pubStr !== "string") continue;
    if (!Array.isArray(emb)) continue;
    const vec = emb.map((x) => Number(x));
    if (vec.some((x) => !Number.isFinite(x))) continue;
    out.push({ content_id: id, source, published_at: pubStr, embedding: vec });
  }
  return out;
}

/**
 * cross-source ペアで similarity ≥ simThreshold AND days_diff ≤ maxDays
 * を満たすものを抽出。同 source 内ペアは除外。
 *
 * @graph-connects none
 */
export function findSameEntityPairs(
  rows: ContentEmbeddingRow[],
  opts: {
    simThreshold?: number;
    maxDays?: number;
    eligibleSources?: readonly string[];
  } = {},
): SameEntityPair[] {
  const sim = opts.simThreshold ?? DEFAULT_SIM_THRESHOLD;
  const maxDays = opts.maxDays ?? DEFAULT_MAX_DAYS;
  const eligible = new Set(opts.eligibleSources ?? DEFAULT_ELIGIBLE_SOURCES);
  const pairs: SameEntityPair[] = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      if (!eligible.has(a.source) || !eligible.has(b.source)) continue;
      if (a.source === b.source) continue;
      const s = cosineSimilarity(a.embedding, b.embedding);
      if (s < sim) continue;
      const days = Math.abs(
        new Date(a.published_at).getTime() - new Date(b.published_at).getTime(),
      ) / (24 * 3600 * 1000);
      if (days > maxDays) continue;
      // 決定論的に src→tgt 方向を固定 (id 文字列順)
      const [srcId, tgtId] = a.content_id < b.content_id
        ? [a.content_id, b.content_id]
        : [b.content_id, a.content_id];
      pairs.push({ src_id: srcId, tgt_id: tgtId, similarity: s, daysDiff: days });
    }
  }
  return pairs;
}

/**
 * SameEntityPair[] → EdgeInput[]。
 *
 * @graph-connects none
 */
export function pairsToEdges(pairs: SameEntityPair[]): EdgeInput[] {
  return pairs.map((p) => ({
    edge_table: "personal_edges",
    edge_type: "same_entity",
    src_kind: "contents",
    src_id: p.src_id,
    tgt_kind: "contents",
    tgt_id: p.tgt_id,
    properties: {
      via: "embedding_cosine",
      similarity: Number(p.similarity.toFixed(4)),
      days_diff: Number(p.daysDiff.toFixed(2)),
    },
  }));
}

/**
 * BQ から embedding を取得 → cross-source 類似ペアを抽出 → `same_entity` edge
 * に変換するエントリポイント。
 *
 * @graph-connects bigquery [reads_from] contents.embedding
 * @graph-connects bigquery [writes_to] personal_edges (same_entity)
 */
export async function parseSameEntity(
  opts: {
    client?: BqQueryClient;
    simThreshold?: number;
    maxDays?: number;
    eligibleSources?: readonly string[];
  } = {},
): Promise<ParseResult> {
  const rows = await loadContentsWithEmbedding(opts.client);
  const pairs = findSameEntityPairs(rows, {
    simThreshold: opts.simThreshold,
    maxDays: opts.maxDays,
    eligibleSources: opts.eligibleSources,
  });
  return { source: "same-entity", nodes: [], edges: pairsToEdges(pairs) };
}
