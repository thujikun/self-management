/**
 * graph-app SA に dataset `ryan` の WRITER 権限を付与する。
 * Pulumi の DatasetIamMember が apply 失敗状態でも単独で動かす用 (one-shot rescue script)。
 *
 * 実行: GOOGLE_APPLICATION_CREDENTIALS unset (ADC で実行)
 *   `unset GOOGLE_APPLICATION_CREDENTIALS && pnpm --filter @self/graph-product grant-dataset-writer`
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business Pulumi 適用が壊れた時の rescue script。SA に dataset WRITER 権限を直接付与し、Pulumi state と乖離した状態を一時的に復旧する用途
 * @graph-connects bigquery [writes_to] dataset access list に SA を追加
 */

import { BigQuery } from "@google-cloud/bigquery";

/** @graph-connects none */
const PROJECT_ID = "ryan-self-management";
/** @graph-connects none */
const DATASET = "ryan";
/** @graph-connects none */
const SA_EMAIL = "graph-app@ryan-self-management.iam.gserviceaccount.com";

/**
 * dataset access list を読み出し → SA WRITER 行を idempotent に追加 → 確認出力。
 *
 * @graph-connects bigquery [writes_to] dataset access list を更新
 */
async function main() {
  const bq = new BigQuery({ projectId: PROJECT_ID });
  const dataset = bq.dataset(DATASET);
  const [meta] = await dataset.getMetadata();
  const access = (meta.access ?? []) as Array<Record<string, unknown>>;

  const has = access.some((a) => a.userByEmail === SA_EMAIL && a.role === "WRITER");
  if (has) {
    console.log("already has WRITER:", SA_EMAIL);
  } else {
    access.push({ role: "WRITER", userByEmail: SA_EMAIL });
    await dataset.setMetadata({ access });
    console.log("granted WRITER to", SA_EMAIL);
  }

  const [meta2] = await dataset.getMetadata();
  console.log("---current access---");
  for (const a of meta2.access ?? []) {
    console.log(
      `  ${a.role}: ${a.userByEmail ?? a.specialGroup ?? a.groupByEmail ?? a.iamMember ?? "?"}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
