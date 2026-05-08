/**
 * BigQuery `contents` 表から「前回 ingest した最新 tweet_id」を取り出す helper。
 *
 * X API の `since_id` query parameter に流し込んで、本当に新規分のみ fetch する true
 * incremental ingest を実現する。Free tier (1,500 reads/月) でも持続可能なための仕組み。
 *
 * since_id サポート endpoint:
 * - own posts (`/2/users/:id/tweets`) → ✓ since_id
 * - mentions (`/2/users/:id/mentions`) → ✓ since_id
 * - liked / bookmark → ✗ (X API がサポートしないので max_pages=1 で代用)
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business 真 incremental ingest 用に BQ contents から MAX(external_id) を引いて X API の since_id に渡す helper。Free tier monthly read quota を超えないための核心
 * @graph-connects bigquery [reads_from] contents 表から (account, source 種別) ごとの最大 tweet_id を取得
 */

import { BigQuery } from "@google-cloud/bigquery";
import { BQ_DATASET } from "../../../schema/shared.js";

/** since_id 取得対象の "kind"。それ以外 (liked/bookmark) は X API が since_id 非対応。 */
export type IncrementalKind = "own" | "mention";

/** @graph-connects none */
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT ?? "ryan-self-management";
/** @graph-connects none */
const LOCATION = "asia-northeast1";

/**
 * kind ごとの WHERE 条件 (metadata は JSON column のため JSON_VALUE で抽出)。
 *
 * @graph-connects none
 */
export const KIND_FILTER: Record<IncrementalKind, string> = {
  own: `JSON_VALUE(metadata, '$.source') = 'x_post' AND JSON_VALUE(metadata, '$.account') = @account`,
  mention: `JSON_VALUE(metadata, '$.source') = 'x_external' AND JSON_VALUE(metadata, '$.engagement') = 'mention' AND JSON_VALUE(metadata, '$.ingested_for') = @account`,
};

/** BigQuery client minimal interface (test inject 可)。 */
export interface BqQueryClient {
  createQueryJob(req: {
    query: string;
    location: string;
    params?: Record<string, unknown>;
  }): Promise<
    [{ getQueryResults(): Promise<[Array<Record<string, unknown>>, ...unknown[]]> }, ...unknown[]]
  >;
}

/**
 * default BigQuery client を返す (本番)。
 *
 * @graph-connects bigquery [reads_from] contents 表
 */
export function defaultBqClient(): BqQueryClient {
  return new BigQuery({ projectId: PROJECT_ID, location: LOCATION }) as unknown as BqQueryClient;
}

/**
 * 指定 (account, kind) について BQ から最新 tweet_id を取得。
 * 該当 row が無い (= 初回 ingest) なら null。
 *
 * @graph-connects bigquery [reads_from] MAX(external_id) を kind 別 WHERE で取得
 */
export async function getLastSeenTweetId(
  account: string,
  kind: IncrementalKind,
  client: BqQueryClient = defaultBqClient(),
): Promise<string | null> {
  const filter = KIND_FILTER[kind];
  const sql = `
    SELECT CAST(MAX(CAST(external_id AS NUMERIC)) AS STRING) AS max_id
    FROM \`${PROJECT_ID}.${BQ_DATASET}.contents\`
    WHERE source = 'x' AND ${filter}
  `;
  const [job] = await client.createQueryJob({
    query: sql,
    location: LOCATION,
    params: { account },
  });
  const [rows] = await job.getQueryResults();
  const value = rows[0]?.max_id;
  return typeof value === "string" && value.length > 0 ? value : null;
}
