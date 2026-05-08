/**
 * X API 認証 helper。
 *
 * - GCP Secret Manager から xmcp-app-credentials + xmcp-user-{account} を fetch
 * - X API の OAuth1 (HMAC-SHA1) 署名を生成
 *
 * apps/xmcp/ (Python) と同じ secret を share するので、両言語側で credentials が一元化される。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business X API ingest 側 (TS) の認証層。Secret Manager から credentials を読み、OAuth1 HMAC-SHA1 署名を組み立てる。Python の xmcp と secret 共有で credentials を二重管理しない
 * @graph-connects secret-manager [reads_from] xmcp-app-credentials + xmcp-user-{account} を読み出して X API 認証
 */

import { createHmac, randomBytes } from "node:crypto";
import { getSecret } from "@self/otel";

/** OAuth1 user-context 認証に必要な 4 値 (consumer + access)。 */
export interface XCreds {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

/**
 * RFC 3986 percent-encoding。`encodeURIComponent` だけだと `! * ' ( )` を残してしまうので
 * OAuth1 base string 用に追加 escape する。
 *
 * @graph-connects none
 */
export function rfc3986Encode(s: string): string {
  return encodeURIComponent(s).replace(
    /[!*'()]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/**
 * 指定 method+url+params に対して OAuth1 Authorization header を計算する。
 *
 * `nonce` / `timestamp` を inject 可能にして、テストで決定的検証ができるようにする。
 *
 * @graph-connects none
 */
export function buildOAuth1Header(
  method: string,
  url: string,
  creds: XCreds,
  queryParams: Record<string, string> = {},
  opts: { nonce?: string; timestamp?: string } = {},
): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: opts.nonce ?? randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: opts.timestamp ?? Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };

  // 1. 全 param (oauth_* + query) を sorted key で「k=v&...」形式に
  const allParams: Array<[string, string]> = [
    ...Object.entries(oauthParams),
    ...Object.entries(queryParams),
  ];
  allParams.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const paramStr = allParams.map(([k, v]) => `${rfc3986Encode(k)}=${rfc3986Encode(v)}`).join("&");

  // 2. signature base string
  const baseStr = [method.toUpperCase(), rfc3986Encode(url), rfc3986Encode(paramStr)].join("&");

  // 3. signing key と HMAC-SHA1
  const signingKey = `${rfc3986Encode(creds.consumerSecret)}&${rfc3986Encode(
    creds.accessTokenSecret,
  )}`;
  const signature = createHmac("sha1", signingKey).update(baseStr).digest("base64");

  // 4. Authorization header (oauth_* のみ、query は含めない)
  const authParams: Record<string, string> = {
    ...oauthParams,
    oauth_signature: signature,
  };
  const headerEntries = Object.keys(authParams)
    .sort()
    .map((k) => `${rfc3986Encode(k)}="${rfc3986Encode(authParams[k])}"`);
  return "OAuth " + headerEntries.join(", ");
}

/**
 * Secret Manager から指定 account の OAuth credentials を読み込む。
 *
 * `xmcp-app-credentials` (consumer + bearer、両アカウント共通) と
 * `xmcp-user-{account}` (per-user OAuth1 access) を JSON parse して合成。
 *
 * @graph-connects secret-manager [reads_from] xmcp-app-credentials + xmcp-user-{account}
 */
export async function loadXCreds(account: string, project?: string): Promise<XCreds> {
  const [appJson, userJson] = await Promise.all([
    getSecret("xmcp-app-credentials", project),
    getSecret(`xmcp-user-${account}`, project),
  ]);
  const app = parseJsonObject(appJson, "xmcp-app-credentials");
  const user = parseJsonObject(userJson, `xmcp-user-${account}`);
  const required = [
    "X_OAUTH_CONSUMER_KEY",
    "X_OAUTH_CONSUMER_SECRET",
    "X_OAUTH_ACCESS_TOKEN",
    "X_OAUTH_ACCESS_TOKEN_SECRET",
  ] as const;
  const merged = { ...app, ...user };
  for (const k of required) {
    if (typeof merged[k] !== "string" || !merged[k]) {
      throw new Error(`loadXCreds(${account}): missing or empty ${k}`);
    }
  }
  return {
    consumerKey: merged.X_OAUTH_CONSUMER_KEY as string,
    consumerSecret: merged.X_OAUTH_CONSUMER_SECRET as string,
    accessToken: merged.X_OAUTH_ACCESS_TOKEN as string,
    accessTokenSecret: merged.X_OAUTH_ACCESS_TOKEN_SECRET as string,
  };
}

/** @graph-connects none */
function parseJsonObject(raw: string, hint: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`secret ${hint} is not valid JSON`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`secret ${hint} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}
