/**
 * BQ idempotent UPSERT helper。
 *
 * 同じ source を再 import した時に row 複製を作らない。
 * 戦略: temp table に staging insert → MERGE → drop temp。
 *
 * BQ の `MERGE INTO ... USING UNNEST(@rows)` も使えるが、配列 size 上限と
 * struct 型の取り回しが面倒なので、staging table 経由が安定。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business 個人グラフ全テーブル共通の idempotent UPSERT 機構。決定的 PK と staging→MERGE の組合せで再 import しても重複や drift を作らないことを担保
 * @graph-connects bigquery [writes_to] 各 node/edge テーブルへ MERGE INTO で UPSERT
 */

import { BigQuery } from "@google-cloud/bigquery";
import { BQ_DATASET } from "../../schema/index.js";

/** @graph-connects none */
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT ?? "ryan-self-management";
/** @graph-connects none */
const LOCATION = "asia-northeast1";

/** @graph-connects none */
const bq = new BigQuery({ projectId: PROJECT_ID, location: LOCATION });

/**
 * 各テーブルの primary key 列名。MERGE の ON 条件に使う。
 *
 * @graph-connects none
 */
const PK_COLUMN: Record<string, string> = {
  persons: "person_id",
  contents: "content_id",
  decisions: "decision_id",
  topics: "topic_id",
  events: "event_id",
  release_notes: "release_note_id",
  product_graph_nodes: "node_id",
  personal_edges: "edge_id",
  release_edges: "edge_id",
  product_graph_edges: "edge_id",
};

/**
 * row を BQ に MERGE (insert or update by PK)。
 *
 * 全 row 同一 schema 前提 (= 同じ table 向け)。複数 table への MERGE は呼び出し側で分割。
 *
 * @param tableName "persons" 等
 * @param rows row オブジェクトの配列。各 row は table schema と一致する key を持つ
 *
 * @graph-connects bigquery [writes_to] staging テーブル作成 → streaming insert → MERGE INTO → drop で UPSERT 実現
 */
export async function mergeRows(
  tableName: string,
  rows: Array<Record<string, unknown>>,
): Promise<{ merged: number }> {
  if (rows.length === 0) return { merged: 0 };

  const pk = PK_COLUMN[tableName];
  if (!pk) {
    throw new Error(`mergeRows: no PK defined for table ${tableName}`);
  }

  const dataset = bq.dataset(BQ_DATASET);
  const target = dataset.table(tableName);

  // 1. staging table 作成 (一時的、auto-expire 1h)
  const stagingName = `_staging_${tableName}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const [meta] = await target.getMetadata();
  const targetSchema = meta.schema;

  await dataset.createTable(stagingName, {
    schema: targetSchema,
    expirationTime: String(Date.now() + 60 * 60 * 1000), // 1h
  });
  const staging = dataset.table(stagingName);

  // schema に存在しない列は drop。JSON 型カラムは object → JSON string に正規化。
  // BQ Streaming Insert API の JSON 列は「JSON 形式でエンコードされた文字列」を要求する。
  const fields = (targetSchema?.fields ?? []) as Array<{ name: string; type?: string }>;
  const allowedCols = new Set(fields.map((f) => f.name));
  const jsonCols = new Set(fields.filter((f) => f.type === "JSON").map((f) => f.name));
  rows = rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (!allowedCols.has(k)) continue;
      if (jsonCols.has(k) && v !== null && v !== undefined && typeof v !== "string") {
        out[k] = JSON.stringify(v);
      } else {
        out[k] = v;
      }
    }
    return out;
  });

  try {
    // 2. staging に insert
    try {
      await staging.insert(rows, { raw: false, skipInvalidRows: false });
    } catch (insertErr) {
      // PartialFailureError の中身を全部出して原因特定
      const e = insertErr as { errors?: Array<{ row: unknown; errors: unknown }>; message?: string };
      if (e.errors && Array.isArray(e.errors) && e.errors.length > 0) {
        const summary = e.errors.slice(0, 3).map((re, idx) => ({
          row_index: idx,
          row_keys: re.row ? Object.keys(re.row as object) : [],
          errors: re.errors,
        }));
        console.error(`bq-merge: insert into ${stagingName} failed for ${e.errors.length} rows. First 3:`);
        console.error(JSON.stringify(summary, null, 2));
      }
      throw insertErr;
    }

    // 3. MERGE
    const targetCols = (targetSchema?.fields ?? []).map((f: { name: string }) => f.name);
    const updateClause = targetCols
      .filter((c: string) => c !== pk && c !== "first_seen_at")
      .map((c: string) => `T.\`${c}\` = S.\`${c}\``)
      .join(",\n      ");
    const insertCols = targetCols.map((c: string) => `\`${c}\``).join(", ");
    const insertVals = targetCols.map((c: string) => `S.\`${c}\``).join(", ");

    const sql = `
MERGE INTO \`${PROJECT_ID}.${BQ_DATASET}.${tableName}\` T
USING \`${PROJECT_ID}.${BQ_DATASET}.${stagingName}\` S
ON T.\`${pk}\` = S.\`${pk}\`
WHEN MATCHED THEN UPDATE SET
      ${updateClause}
WHEN NOT MATCHED THEN INSERT (${insertCols}) VALUES (${insertVals});
    `.trim();

    const [job] = await bq.createQueryJob({ query: sql, location: LOCATION });
    await job.getQueryResults();

    return { merged: rows.length };
  } finally {
    // 4. staging を削除 (1h auto-expire でも切れるが explicit に)
    await staging.delete({ ignoreNotFound: true } as { ignoreNotFound: boolean }).catch(() => {
      // 削除失敗しても auto-expire で消えるので無視
    });
  }
}
