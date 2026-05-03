/**
 * BQ tables を idempotent に作成する。
 * 前提: `infra/core` の `pulumi up` で dataset `ryan` が作成済みであること。
 * 認証: `GOOGLE_APPLICATION_CREDENTIALS` または `gcloud auth application-default login`。
 *
 * 実行: `pnpm --filter @self/graph-product init-bq`
 */

import { BigQuery } from "@google-cloud/bigquery";
import { ALL_TABLES, BQ_DATASET } from "../src/schema/index.js";

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT ?? "ryan-self-management";
const LOCATION = "asia-northeast1";

async function main(): Promise<void> {
  const bq = new BigQuery({ projectId: PROJECT_ID, location: LOCATION });
  const dataset = bq.dataset(BQ_DATASET);

  const [exists] = await dataset.exists();
  if (!exists) {
    throw new Error(
      `Dataset ${PROJECT_ID}:${BQ_DATASET} not found. Run \`pulumi up\` in infra/core first.`,
    );
  }

  for (const def of ALL_TABLES) {
    const table = dataset.table(def.name);
    const [tableExists] = await table.exists();
    if (tableExists) {
      console.log(`✓ ${BQ_DATASET}.${def.name} already exists`);
      continue;
    }
    await dataset.createTable(def.name, def.options);
    console.log(`✓ created ${BQ_DATASET}.${def.name}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
