/**
 * Vertex AI gemini-embedding-2 wrapper。
 *
 * - 3072 次元 multimodal embedding model
 * - endpoint: `https://aiplatform.googleapis.com/v1/projects/<id>/locations/global/publishers/google/models/gemini-embedding-2:embedContent`
 * - 認証: ADC (GOOGLE_APPLICATION_CREDENTIALS) の Bearer token
 * - batch endpoint なし、複数件は内部で並列 fetch
 *
 * 用途別 task_type:
 * - `RETRIEVAL_DOCUMENT` (default): index 投入時に使う (静的データ側)
 * - `RETRIEVAL_QUERY`: search 時の query 側 (動的入力)
 * - `SEMANTIC_SIMILARITY`: 対称な類似度比較
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business gemini-embedding-2 への薄いクライアント。Migration (RETRIEVAL_DOCUMENT) と MCP search (RETRIEVAL_QUERY) の両方から再利用される共有レイヤー
 * @graph-connects vertex-ai [calls] :embedContent endpoint で embedding 取得
 */

import { GoogleAuth } from "google-auth-library";

/** @graph-connects none */
export const EMBEDDING_MODEL = "gemini-embedding-2";
/** @graph-connects none */
export const EMBEDDING_DIMENSIONS = 3072;
/** @graph-connects none */
export const EMBEDDING_LOCATION = "global";

/** @graph-connects none */
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT ?? "ryan-self-management";

/**
 * embedContent endpoint URL。global region 固定 (gemini-embedding-2 の制約)。
 *
 * @graph-connects none
 */
const ENDPOINT = `https://aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${EMBEDDING_LOCATION}/publishers/google/models/${EMBEDDING_MODEL}:embedContent`;

/** @graph-connects none */
const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

/**
 * ADC から Bearer token を取って Authorization header 値を返す。
 *
 * @graph-connects none
 */
async function getAuthHeader(): Promise<string> {
  const tok = await auth.getAccessToken();
  if (!tok) throw new Error("embedding: failed to obtain access token (ADC)");
  return `Bearer ${tok}`;
}

interface EmbedContentResponse {
  embedding: { values: number[] };
}

export type EmbedTaskType =
  | "RETRIEVAL_DOCUMENT"
  | "RETRIEVAL_QUERY"
  | "SEMANTIC_SIMILARITY"
  | "CLASSIFICATION"
  | "CLUSTERING";

/**
 * 単一テキストを embedding。長文は API 側で 8192 token まで truncate される。
 *
 * task_type は API レベルで未対応なので、現状は body に含めず query/document を区別したい場合は呼び出し側で
 * prefix を付けるか SEMANTIC_SIMILARITY 互換と扱う。
 *
 * @graph-connects vertex-ai [calls] :embedContent を 1 件呼び出し
 */
export async function embedText(text: string, _taskType?: EmbedTaskType): Promise<number[]> {
  if (!text || text.trim().length === 0) {
    throw new Error("embedText: empty input");
  }
  const authHeader = await getAuthHeader();
  const body = { content: { parts: [{ text }] } };
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Vertex AI embedding failed (${res.status}): ${errText}`);
  }
  const data = (await res.json()) as EmbedContentResponse;
  const values = data.embedding?.values;
  if (!values || values.length === 0) {
    throw new Error(`Vertex AI embedding returned no values: ${JSON.stringify(data)}`);
  }
  return values;
}

/**
 * 複数テキストを並列 embedding。`:embedContent` には batch endpoint がないので
 * 内部で N 並列 fetch。concurrency=8 が default (rate limit 安全圏)。
 *
 * @graph-connects vertex-ai [calls] :embedContent を N 並列呼び出し
 */
export async function embedBatch(
  texts: string[],
  concurrency = 8,
  taskType?: EmbedTaskType,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const out: number[][] = new Array(texts.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, texts.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= texts.length) return;
      out[i] = await embedText(texts[i], taskType);
    }
  });
  await Promise.all(workers);
  return out;
}
