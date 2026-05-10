/**
 * Vertex AI gemini-embedding-2 wrapper。
 *
 * - 3072 次元 multimodal embedding model (text / image / audio / video / pdf 対応)
 * - endpoint: `https://aiplatform.googleapis.com/v1/projects/<PROJECT>/locations/global/publishers/google/models/gemini-embedding-2:embedContent`
 *   (multimodal model のため `:embedContent` を使う。`:predict` は legacy text 系のみ)
 * - 認証: GCP ADC (`GOOGLE_APPLICATION_CREDENTIALS` env、SA key) → google-auth-library で access token 取得
 * - location は `global` 固定 (gemini-embedding-2 は global / us / eu に提供、global を採用)
 * - 1 request = 1 instance、複数件は内部で並列 fetch
 *
 * 用途別 task_type:
 * - `RETRIEVAL_DOCUMENT` (default): index 投入時に使う (静的データ側)
 * - `RETRIEVAL_QUERY`: search 時の query 側 (動的入力)
 * - `SEMANTIC_SIMILARITY`: 対称な類似度比較
 *
 * 注: AI Studio (gemini-embedding-001) を一時的に使用していた経緯があるが、2026-03-23 の
 * AI Studio prepay 移行で free tier が事実上終了したため Vertex AI に再切替。Vertex は
 * GCP $300 trial credit / SA 認証で運用可能。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business Vertex AI gemini-embedding-2 への薄いクライアント。Migration (RETRIEVAL_DOCUMENT) と MCP search (RETRIEVAL_QUERY) の両方から再利用される共有レイヤー。AI Studio の prepay 強制を回避し SA + ADC で課金経路を GCP billing に統一する設計
 * @graph-connects vertex-ai [calls] :embedContent endpoint で embedding 取得
 */

import { GoogleAuth } from "google-auth-library";

/** @graph-connects none */
export const EMBEDDING_MODEL = "gemini-embedding-2";
/** @graph-connects none */
export const EMBEDDING_DIMENSIONS = 3072;
/** @graph-connects none */
export const EMBEDDING_LOCATION = "global";

/**
 * `:embedContent` endpoint URL を組み立てる。`GOOGLE_CLOUD_PROJECT` env を毎回読むので、
 * direnv reload や test での env 切替に追随する。`.envrc` は workspace root で
 * `GOOGLE_CLOUD_PROJECT` を必ず export する想定で、未設定なら fallback せず throw して
 * silent に意図外 project に課金が乗るのを防ぐ。
 *
 * @graph-connects none
 */
function getEndpoint(): string {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  if (!project) {
    throw new Error(
      "embedding: GOOGLE_CLOUD_PROJECT env var が未設定。`.envrc` 経由で direnv が export する想定 (workspace root から実行)。",
    );
  }
  return `https://aiplatform.googleapis.com/v1/projects/${project}/locations/${EMBEDDING_LOCATION}/publishers/google/models/${EMBEDDING_MODEL}:embedContent`;
}

/** @graph-connects none */
let _auth: GoogleAuth | null = null;

/**
 * GoogleAuth client を 1 度だけ生成して共有。test では `_setAuthForTest` で差し替え可。
 *
 * @graph-connects none
 */
function getAuth(): GoogleAuth {
  if (!_auth) {
    _auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
  }
  return _auth;
}

/**
 * テスト hook: GoogleAuth を差し替え。production からは呼ばない。
 *
 * @graph-connects none
 */
export function _setAuthForTest(auth: GoogleAuth | null): void {
  _auth = auth;
}

/**
 * ADC から access token を取得。`GOOGLE_APPLICATION_CREDENTIALS` (SA key) または
 * `gcloud auth application-default login` を期待。
 *
 * @graph-connects vertex-ai [calls] OAuth2 token endpoint 経由で access token を取得
 */
async function getAccessToken(): Promise<string> {
  const auth = getAuth();
  const client = await auth.getClient();
  const tokenRes = await client.getAccessToken();
  const token = tokenRes.token;
  if (!token) {
    throw new Error(
      "embedding: GCP access token の取得に失敗。GOOGLE_APPLICATION_CREDENTIALS (SA key) または `gcloud auth application-default login` を確認してください。",
    );
  }
  return token;
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
 * @graph-connects vertex-ai [calls] :embedContent を 1 件呼び出し
 */
export async function embedText(text: string, taskType?: EmbedTaskType): Promise<number[]> {
  if (!text || text.trim().length === 0) {
    throw new Error("embedText: empty input");
  }
  const token = await getAccessToken();
  const body: Record<string, unknown> = {
    content: { parts: [{ text }] },
  };
  if (taskType) body.taskType = taskType;
  const res = await fetch(getEndpoint(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
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
 * 内部で N 並列 fetch する。concurrency=8 が default (Vertex AI quota 安全圏)。
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
