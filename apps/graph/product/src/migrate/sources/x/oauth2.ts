/**
 * X API OAuth 2.0 user-context auth (bookmark / engagement endpoints 用)。
 *
 * - GCP Secret Manager から `xmcp-user-{account}-oauth2` を読む
 * - access_token が expired なら refresh_token で新規発行
 * - 新 token を Secret Manager に書き戻して次回も使える状態にする
 *
 * OAuth1 の `auth.ts` と co-exist。bookmark / repost-of-me / quote-of-me 等の
 * "OAuth 1.0a User Context is forbidden" endpoint 用に切り出している。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business OAuth2 user-context bearer 取得 + auto-refresh + Secret Manager 書き戻し。bookmark / 自分の tweet への外部 engagement endpoint で必須。401 でもプロセス再起動なしに継続できるよう memory cache + write-through で運用
 * @graph-connects secret-manager [reads_from] xmcp-app-credentials + xmcp-user-{account}-oauth2 を取得
 * @graph-connects secret-manager [writes_to] refresh 後の新 access/refresh token を新 version として書き込む
 * @graph-connects x-api [calls] /2/oauth2/token (refresh_token grant)
 */

import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { getSecret } from "@self/otel";

/** @graph-connects none */
const TOKEN_URL = "https://api.x.com/2/oauth2/token";
/**
 * access_token expiry 判定の安全マージン (sec)。これ以下なら expired 扱いで refresh
 *
 * @graph-connects none
 */
const REFRESH_BUFFER_SEC = 60;

export interface XOAuth2Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch sec
}

export interface XOAuth2AppCreds {
  clientId: string;
  clientSecret: string;
}

/**
 * プロセス内 memory cache (account → tokens)。
 *
 * @graph-connects none
 */
const cache = new Map<string, XOAuth2Tokens>();

/**
 * test 用 hook: cache を直接書く / クリアする。
 *
 * @graph-connects none
 */
export function _setOAuth2CacheForTest(account: string, tokens: XOAuth2Tokens | null): void {
  if (tokens === null) cache.delete(account);
  else cache.set(account, tokens);
}

/** @graph-connects none */
export function clearOAuth2Cache(): void {
  cache.clear();
}

/**
 * `xmcp-app-credentials` から OAuth2 client credentials を取り出す。
 *
 * @graph-connects secret-manager [reads_from] xmcp-app-credentials
 */
export async function loadOAuth2AppCreds(project?: string): Promise<XOAuth2AppCreds> {
  const raw = await getSecret("xmcp-app-credentials", project);
  const obj = JSON.parse(raw) as Record<string, unknown>;
  const clientId = obj.X_CLIENT_ID;
  const clientSecret = obj.X_CLIENT_SECRET;
  if (typeof clientId !== "string" || !clientId || typeof clientSecret !== "string" || !clientSecret) {
    throw new Error("xmcp-app-credentials: X_CLIENT_ID / X_CLIENT_SECRET missing");
  }
  return { clientId, clientSecret };
}

/**
 * `xmcp-user-{account}-oauth2` secret を fetch して JSON parse。
 *
 * @graph-connects secret-manager [reads_from] xmcp-user-{account}-oauth2
 */
export async function loadOAuth2Tokens(
  account: string,
  project?: string,
): Promise<XOAuth2Tokens> {
  const raw = await getSecret(`xmcp-user-${account}-oauth2`, project);
  const obj = JSON.parse(raw) as Record<string, unknown>;
  const accessToken = obj.X_OAUTH2_ACCESS_TOKEN;
  const refreshToken = obj.X_OAUTH2_REFRESH_TOKEN;
  const expiresAt = obj.X_OAUTH2_EXPIRES_AT;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error(`xmcp-user-${account}-oauth2: X_OAUTH2_ACCESS_TOKEN missing`);
  }
  if (typeof refreshToken !== "string" || !refreshToken) {
    throw new Error(`xmcp-user-${account}-oauth2: X_OAUTH2_REFRESH_TOKEN missing`);
  }
  if (typeof expiresAt !== "number") {
    throw new Error(`xmcp-user-${account}-oauth2: X_OAUTH2_EXPIRES_AT missing or not a number`);
  }
  return { accessToken, refreshToken, expiresAt };
}

/**
 * 現在時刻 (sec) と expiresAt を比較して expired ならば true。
 *
 * @graph-connects none
 */
export function isExpired(tokens: XOAuth2Tokens, nowSec: number = Math.floor(Date.now() / 1000)): boolean {
  return tokens.expiresAt - nowSec <= REFRESH_BUFFER_SEC;
}

/** fetch 風 HTTP 呼び出し abstraction (test 用に inject) */
export type FetchFn = (url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}>;

/**
 * `/2/oauth2/token` に refresh_token grant を投げて新 tokens を取得。
 *
 * @graph-connects x-api [calls] OAuth2 token refresh endpoint
 */
export async function refreshTokens(
  app: XOAuth2AppCreds,
  refreshToken: string,
  fetcher: FetchFn = globalThis.fetch as unknown as FetchFn,
): Promise<XOAuth2Tokens> {
  const basic = Buffer.from(`${app.clientId}:${app.clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }).toString();
  const res = await fetcher(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`OAuth2 refresh failed: ${res.status} ${txt.slice(0, 500)}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  const accessToken = data.access_token;
  const newRefreshToken = data.refresh_token ?? refreshToken;
  const expiresIn = data.expires_in;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error("OAuth2 refresh: missing access_token in response");
  }
  if (typeof newRefreshToken !== "string" || !newRefreshToken) {
    throw new Error("OAuth2 refresh: missing refresh_token in response");
  }
  if (typeof expiresIn !== "number") {
    throw new Error("OAuth2 refresh: missing expires_in in response");
  }
  return {
    accessToken,
    refreshToken: newRefreshToken,
    expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
  };
}

/** addSecretVersion 1 メソッドだけを依存するための minimal interface (test 用に inject 可能)。 */
export interface SecretWriter {
  addSecretVersion(req: { parent: string; payload: { data: Buffer } }): Promise<unknown>;
}

/**
 * default SecretWriter (本番では `new SecretManagerServiceClient()`、test では mock module で差し替え)。
 *
 * @graph-connects secret-manager [writes_to] 標準の SDK client を 1 個生成して返す
 */
export function newDefaultSecretWriter(): SecretWriter {
  return new SecretManagerServiceClient();
}

/**
 * 新 tokens を Secret Manager に新 version として書き込む。
 *
 * @graph-connects secret-manager [writes_to] xmcp-user-{account}-oauth2
 */
export async function writeOAuth2Tokens(
  account: string,
  tokens: XOAuth2Tokens,
  project?: string,
  writer?: SecretWriter,
): Promise<void> {
  const projectId = project ?? process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) {
    throw new Error("writeOAuth2Tokens: project not specified and GOOGLE_CLOUD_PROJECT not set");
  }
  const client: SecretWriter = writer ?? newDefaultSecretWriter();
  const payload = JSON.stringify({
    X_OAUTH2_ACCESS_TOKEN: tokens.accessToken,
    X_OAUTH2_REFRESH_TOKEN: tokens.refreshToken,
    X_OAUTH2_EXPIRES_AT: tokens.expiresAt,
  });
  await client.addSecretVersion({
    parent: `projects/${projectId}/secrets/xmcp-user-${account}-oauth2`,
    payload: { data: Buffer.from(payload, "utf8") },
  });
}

export interface GetBearerOptions {
  project?: string;
  fetcher?: FetchFn;
  /** 新規 token を SM に書き戻すか (default: true) */
  writeBack?: boolean;
  /** writeBack 用の writer (test inject) */
  writer?: SecretWriter;
}

/**
 * 指定 account の有効な access_token を返す。expired なら refresh + 書き戻し。
 * memory cache がヒットすればそれを優先 (同一プロセス内の連続呼び出しを高速化)。
 *
 * @graph-connects secret-manager [reads_from] tokens を読む
 * @graph-connects x-api [calls] expired 時に refresh
 */
export async function getOAuth2Bearer(
  account: string,
  opts: GetBearerOptions = {},
): Promise<string> {
  const cached = cache.get(account);
  if (cached && !isExpired(cached)) return cached.accessToken;

  const tokens = cached ?? (await loadOAuth2Tokens(account, opts.project));
  if (!isExpired(tokens)) {
    cache.set(account, tokens);
    return tokens.accessToken;
  }

  const app = await loadOAuth2AppCreds(opts.project);
  const refreshed = await refreshTokens(app, tokens.refreshToken, opts.fetcher);
  cache.set(account, refreshed);
  if (opts.writeBack !== false) {
    await writeOAuth2Tokens(account, refreshed, opts.project, opts.writer);
  }
  return refreshed.accessToken;
}
