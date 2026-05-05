/**
 * 既存 BQ tables に embedding / embedding_model 列を追加する一回限りの migration。
 *
 * 各 node table に対し:
 *   ALTER TABLE ... ADD COLUMN IF NOT EXISTS embedding ARRAY<FLOAT64>
 *   ALTER TABLE ... ADD COLUMN IF NOT EXISTS embedding_model STRING
 *
 * 完了後は schema TS と整合する。再実行しても IF NOT EXISTS で no-op。
 *
 * 実行: `pnpm --filter @self/graph-product alter-add-embedding`
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business 既存テーブルへの embedding 列追加 one-shot migration。schema TS との差分を BQ 側に反映する用途
 * @graph-connects bigquery [writes_to] 7 つの node テーブルに ALTER TABLE で列追加
 */

import { BigQuery } from "@google-cloud/bigquery";

/** @graph-connects none */
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT ?? "ryan-self-management";
/** @graph-connects none */
const LOCATION = "asia-northeast1";
/** @graph-connects none */
const DATASET = "ryan";

/** @graph-connects none */
const NODE_TABLES = [
  "persons",
  "contents",
  "decisions",
  "topics",
  "events",
  "release_notes",
  "product_graph_nodes",
];

/**
 * 各 table に embedding 列追加 → verify。
 *
 * @graph-connects bigquery [writes_to] ALTER TABLE で列追加
 */
async function main() {
  const bq = new BigQuery({ projectId: PROJECT_ID, location: LOCATION });

  for (const table of NODE_TABLES) {
    const sql = `
ALTER TABLE \`${PROJECT_ID}.${DATASET}.${table}\`
  ADD COLUMN IF NOT EXISTS embedding ARRAY<FLOAT64>,
  ADD COLUMN IF NOT EXISTS embedding_model STRING
`.trim();

    process.stdout.write(`ALTER ${table} ... `);
    const [job] = await bq.createQueryJob({ query: sql, location: LOCATION });
    await job.getQueryResults();
    console.log("ok");
  }

  console.log("---verify---");
  for (const table of NODE_TABLES) {
    const [meta] = await bq.dataset(DATASET).table(table).getMetadata();
    const cols = (meta.schema?.fields ?? []).map((f: { name: string }) => f.name);
    const hasEmbedding = cols.includes("embedding");
    const hasModel = cols.includes("embedding_model");
    console.log(`${table}: embedding=${hasEmbedding} embedding_model=${hasModel}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
