/**
 * Google AI Studio (Generative Language API) gemini-embedding-001 wrapper。
 *
 * - 3072 次元 multimodal embedding model (Vertex AI の gemini-embedding-2 と互換次元)
 * - endpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=<API_KEY>`
 * - 認証: AI Studio で発行する **API key** (`GEMINI_API_KEY` env)
 * - free tier あり (rate limit ~1500 RPM)、self-management の graph build スケールでは費用ゼロで運用できる
 * - batch endpoint なし、複数件は内部で並列 fetch
 *
 * 用途別 task_type:
 * - `RETRIEVAL_DOCUMENT` (default): index 投入時に使う (静的データ側)
 * - `RETRIEVAL_QUERY`: search 時の query 側 (動的入力)
 * - `SEMANTIC_SIMILARITY`: 対称な類似度比較
 *
 * 注: 過去の embedding は Vertex AI gemini-embedding-2 で生成されているが、graph:build で
 * 全件再生成すれば AI Studio gemini-embedding-001 ベースに揃うので互換性は問題にならない。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business AI Studio gemini-embedding-001 への薄いクライアント。Vertex (paid) から AI Studio (free tier) に切替えて個人 repo の graph:build を費用ゼロで回せるようにした共有レイヤー。Migration (RETRIEVAL_DOCUMENT) と MCP search (RETRIEVAL_QUERY) の両方から再利用される
 * @graph-connects ai-studio [calls] :embedContent endpoint で embedding 取得
 */

/** @graph-connects none */
export const EMBEDDING_MODEL = "gemini-embedding-001";
/** @graph-connects none */
export const EMBEDDING_DIMENSIONS = 3072;

/**
 * AI Studio embedContent endpoint URL。`?key=<API_KEY>` で認証。
 *
 * @graph-connects none
 */
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent`;

/**
 * env から API key を取得。`.envrc` で `export GEMINI_API_KEY=...` を期待する。
 * AI Studio (https://aistudio.google.com/apikey) で発行した key を貼る。
 *
 * @graph-connects none
 */
function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.length === 0) {
    throw new Error(
      "embedding: GEMINI_API_KEY env var が未設定。AI Studio (https://aistudio.google.com/apikey) で発行して .envrc に追加してください。",
    );
  }
  return key;
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
 * @graph-connects ai-studio [calls] :embedContent を 1 件呼び出し
 */
export async function embedText(text: string, taskType?: EmbedTaskType): Promise<number[]> {
  if (!text || text.trim().length === 0) {
    throw new Error("embedText: empty input");
  }
  const key = getApiKey();
  const body: Record<string, unknown> = {
    model: `models/${EMBEDDING_MODEL}`,
    content: { parts: [{ text }] },
  };
  if (taskType) body.taskType = taskType;
  const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`AI Studio embedding failed (${res.status}): ${errText}`);
  }
  const data = (await res.json()) as EmbedContentResponse;
  const values = data.embedding?.values;
  if (!values || values.length === 0) {
    throw new Error(`AI Studio embedding returned no values: ${JSON.stringify(data)}`);
  }
  return values;
}

/**
 * 複数テキストを並列 embedding。`:embedContent` には batch endpoint がないので
 * 内部で N 並列 fetch。concurrency=8 が default (AI Studio free tier 1500 RPM 安全圏)。
 *
 * @graph-connects ai-studio [calls] :embedContent を N 並列呼び出し
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
