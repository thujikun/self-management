/**
 * Secret Manager から OTLP write token を取得するヘルパー。
 *
 * 一度取得した token は in-memory cache。プロセス内で複数回 init すると同じ値を返す。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain infra
 * @graph-business GCP Secret Manager から `grafana-otlp-write-token` の最新版を取り出す薄いラッパー。OTel init / logger destination の両方から呼ばれるため module-level に in-memory cache を持つ
 * @graph-connects secret-manager [reads_from] grafana-otlp-write-token の最新 version をロード
 */

import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

/** @graph-connects none */
const cache = new Map<string, string>();

/**
 * 指定 secret の最新 version の payload を string で返す。
 *
 * `project` 未指定時は `GOOGLE_CLOUD_PROJECT` から取る。
 *
 * @graph-connects secret-manager [reads_from] secret payload を取得
 */
export async function getSecret(secretName: string, project?: string): Promise<string> {
  const projectId = project ?? process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) {
    throw new Error("getSecret: project not specified and GOOGLE_CLOUD_PROJECT not set");
  }

  const cacheKey = `${projectId}:${secretName}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const client = new SecretManagerServiceClient();
  const [version] = await client.accessSecretVersion({
    name: `projects/${projectId}/secrets/${secretName}/versions/latest`,
  });
  const payload = version.payload?.data;
  if (!payload) {
    throw new Error(`getSecret: empty payload for ${projectId}/${secretName}`);
  }
  const value = typeof payload === "string" ? payload : Buffer.from(payload).toString("utf8");
  cache.set(cacheKey, value);
  return value;
}

/**
 * テスト・rotation 用に in-memory cache をクリアする。
 *
 * @graph-connects none
 */
export function clearSecretCache(): void {
  cache.clear();
}

/**
 * テストフック: secret 値を直接 cache に注入し、Secret Manager への実呼び出しを回避する。
 * production code からは呼ばないこと (test only)。
 *
 * @graph-connects none
 */
export function _setSecretCacheForTest(secretName: string, value: string, project?: string): void {
  const projectId = project ?? process.env.GOOGLE_CLOUD_PROJECT ?? "";
  const cacheKey = `${projectId}:${secretName}`;
  cache.set(cacheKey, value);
}
