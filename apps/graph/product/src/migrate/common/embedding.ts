/**
 * Vertex AI gemini-embedding-2 client (multimodal、3072 次元、:embedContent endpoint)。
 *
 * - body_summary を入力に取り、3072 次元 ARRAY<FLOAT64> を返す。
 * - 認証は GOOGLE_APPLICATION_CREDENTIALS (.config/gcp-sa.json) 経由 ADC。
 * - Pulumi で `roles/aiplatform.user` を SA に付与してある前提。
 * - 旧 `:predict` ではなく `:embedContent` (Gemini API 系)。batch endpoint なし、
 *   複数件は内部で N 並列 fetch する。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business gemini-embedding-2 への薄いラッパー。各 node の body_summary を 3072 次元ベクトルに変換し、BQ の embedding カラムへ投入する用途。region は asia-northeast1 不可で global 固定、:embedContent endpoint で Gemini 系 multimodal API を叩く
 * @graph-connects vertex-ai [calls] gemini-embedding-2 :embedContent を呼んで embedding 取得
 */

import { GoogleAuth } from "google-auth-library";
import { EMBEDDING_LOCATION, EMBEDDING_MODEL } from "../../schema/index.js";

/** @graph-connects none */
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT ?? "ryan-self-management";

/**
 * Vertex AI publisher endpoint。
 * gemini-embedding-2 は `global` 限定 (`us-central1` は HTTP 404 確認済)。
 * dataset (asia-northeast1) と分離するが embedding だけのコールなので latency は許容。
 *
 * `global` の場合 host に region prefix を付けない。
 *
 * @graph-connects none
 */
const ENDPOINT =
  EMBEDDING_LOCATION === "global"
    ? `https://aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/global/publishers/google/models/${EMBEDDING_MODEL}:embedContent`
    : `https://${EMBEDDING_LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${EMBEDDING_LOCATION}/publishers/google/models/${EMBEDDING_MODEL}:embedContent`;

/** @graph-connects none */
const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

/**
 * google-auth-library の `getRequestHeaders()` は version によって `Headers` を返したり
 * `Record<string, string>` を返したりするので、Bearer token だけ explicit に取る。
 *
 * @graph-connects none
 */
async function getAuthHeader(): Promise<string> {
  const tok = await auth.getAccessToken();
  if (!tok) throw new Error("embedding: failed to obtain access token (ADC)");
  return `Bearer ${tok}`;
}

/**
 * `:embedContent` の response shape。Gemini API 系の単一 embedding 形式。
 */
interface EmbedContentResponse {
  embedding: { values: number[] };
}

/**
 * 単一テキストを embedding。長文は API 側で truncate される (8192 input token まで)。
 *
 * @param text 入力テキスト (typically body_summary)
 * @returns 3072 次元 float 配列
 *
 * @graph-connects vertex-ai [calls] gemini-embedding-2 :embedContent を 1 件呼び出し
 */
export async function embedText(text: string): Promise<number[]> {
  if (!text || text.trim().length === 0) {
    throw new Error("embedText: empty input");
  }

  const authHeader = await getAuthHeader();

  const body = {
    content: { parts: [{ text }] },
  };

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
 * 複数テキストを並列 embedding。Vertex AI の `:embedContent` には batch endpoint が
 * 提供されていないので、内部で `concurrency` 件ずつ fetch して結果を並べ替える。
 *
 * concurrency=8 は経験則 (rate-limit を超えにくい)。失敗時は呼び出し側で handle。
 *
 * @graph-connects vertex-ai [calls] gemini-embedding-2 :embedContent を N 並列呼び出し
 */
export async function embedBatch(texts: string[], concurrency = 8): Promise<number[][]> {
  if (texts.length === 0) return [];

  const out: number[][] = new Array(texts.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, texts.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= texts.length) return;
      out[i] = await embedText(texts[i]);
    }
  });
  await Promise.all(workers);
  return out;
}
