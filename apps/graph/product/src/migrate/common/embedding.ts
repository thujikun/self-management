/**
 * Vertex AI gemini-embedding-2 client。
 *
 * - body_summary を入力に取り、3072 次元 ARRAY<FLOAT64> を返す。
 * - 認証は GOOGLE_APPLICATION_CREDENTIALS (.config/gcp-sa.json) 経由 ADC。
 * - Pulumi で `roles/aiplatform.user` を SA に付与してある前提。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business gemini-embedding-2 への薄いラッパー。各 node の body_summary を 3072 次元ベクトルに変換し、BQ の embedding カラムへ投入する用途。region は asia-northeast1 不可で global を使う
 * @graph-connects vertex-ai [calls] gemini-embedding-2 :predict を呼んで embedding 取得
 */

import { GoogleAuth } from "google-auth-library";
import { EMBEDDING_LOCATION, EMBEDDING_MODEL } from "../../schema/index.js";

/** @graph-connects none */
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT ?? "ryan-self-management";

/**
 * Vertex AI publisher endpoint。
 * `gemini-embedding-2` は `global` / `us` / `europe` のみ提供されているため、
 * dataset (asia-northeast1) とは region が分離する。`global` 経由で呼ぶ。
 *
 * `global` の場合 host に region prefix を付けない。
 *
 * @graph-connects none
 */
const ENDPOINT =
  EMBEDDING_LOCATION === "global"
    ? `https://aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/global/publishers/google/models/${EMBEDDING_MODEL}:predict`
    : `https://${EMBEDDING_LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${EMBEDDING_LOCATION}/publishers/google/models/${EMBEDDING_MODEL}:predict`;

/** @graph-connects none */
const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

interface PredictResponse {
  predictions: Array<{
    embeddings: {
      values: number[];
      statistics?: { token_count: number; truncated: boolean };
    };
  }>;
}

/**
 * 単一テキストを embedding。長文は API 側で truncate される (8K input token まで)。
 *
 * @param text 入力テキスト (typically body_summary)
 * @param taskType embedding 用途 (RETRIEVAL_DOCUMENT 推奨、検索対象として保存)
 * @returns 3072 次元 float 配列
 *
 * @graph-connects vertex-ai [calls] gemini-embedding-2 :predict を 1 件呼び出し
 */
export async function embedText(
  text: string,
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" | "SEMANTIC_SIMILARITY" = "RETRIEVAL_DOCUMENT",
): Promise<number[]> {
  if (!text || text.trim().length === 0) {
    throw new Error("embedText: empty input");
  }

  const client = await auth.getClient();
  const headers = await client.getRequestHeaders();

  const body = {
    instances: [{ content: text, task_type: taskType }],
  };

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Vertex AI embedding failed (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as PredictResponse;
  const values = data.predictions?.[0]?.embeddings?.values;
  if (!values || values.length === 0) {
    throw new Error(`Vertex AI embedding returned no values: ${JSON.stringify(data)}`);
  }
  return values;
}

/**
 * 複数テキストを batch embedding。Vertex AI の predict は最大 250 instances / req。
 * 大量の場合は呼び出し側で chunk して。
 *
 * @graph-connects vertex-ai [calls] gemini-embedding-2 :predict を batch 呼び出し
 */
export async function embedBatch(
  texts: string[],
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" | "SEMANTIC_SIMILARITY" = "RETRIEVAL_DOCUMENT",
): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (texts.length > 250) {
    throw new Error(`embedBatch: max 250 texts per call, got ${texts.length}`);
  }

  const client = await auth.getClient();
  const headers = await client.getRequestHeaders();

  const body = {
    instances: texts.map((t) => ({ content: t, task_type: taskType })),
  };

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Vertex AI embedding batch failed (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as PredictResponse;
  return data.predictions.map((p) => p.embeddings.values);
}
