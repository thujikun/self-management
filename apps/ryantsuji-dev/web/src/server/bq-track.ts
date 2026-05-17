/**
 * 自前 analytics の BQ 書き込み経路。
 *
 * client は `navigator.sendBeacon` で `/api/track` に JSON 1 行を送り、本 module が:
 * 1. `env.GCP_SA_JSON` (Worker secret) を parse して SA credentials を取り出す
 * 2. RS256 JWT を Web Crypto SubtleCrypto で署名
 * 3. JWT-bearer grant で OAuth2 access token を取得 (token は isolate scope で cache)
 * 4. BQ `tabledata.insertAll` REST API で 1 行 streaming insert
 *
 * privacy ポリシー:
 * - IP / cookie tracking 無し
 * - session_id は client が sessionStorage に持つ UUID (tab close で揮発)
 * - user_agent は request header から server 側で取って raw 保存 (容量都合で truncate)
 *
 * fail-open: GCP / BQ への送信に失敗しても client には 204 を返し続ける。analytics の
 * 落ちが user 体験に伝播しないことを最優先する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 自前 RUM/analytics の BQ 書き込み経路。GCP SA JSON を Worker secret として持ち、Web Crypto で RS256 JWT 署名 → OAuth2 token 交換 → tabledata.insertAll で 1 行 streaming insert。token は isolate scope で 50min cache、cold-start 直後に並行 cache miss が来ても in-flight Promise を共有して OAuth 経路は 1 回に集約 (thundering-herd 抑止)。失敗時も client には 204 を返し RUM が user 体験に伝播しない fail-open
 * @graph-connects bigquery [writes_to] ryan.web_events table に streaming insert (tabledata.insertAll REST)
 * @graph-connects iam [calls] graph-app SA で OAuth2 token を取得 (https://oauth2.googleapis.com/token)
 */

/**
 * client が `/api/track` に POST する payload の shape。Zod validate せず手書きの
 * `validateTrackInput` で軽量検査するのは、analytics 経路を hot path から外して
 * Worker CPU 予算を 1ms 以下に保つため。
 *
 * @graph-connects none
 */
export interface TrackInput {
  event_type: string;
  path?: string;
  slug?: string;
  lang?: string;
  referrer?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  viewport_w?: number;
  viewport_h?: number;
  locale?: string;
  session_id?: string;
}

/**
 * BQ row として送る形 (table schema と 1:1)。`ingested_at` は BQ 側 default で
 * `CURRENT_TIMESTAMP` が入るので row には含めない。
 *
 * @graph-connects none
 */
export interface TrackRow {
  ts: string;
  event_type: string;
  path?: string;
  slug?: string;
  lang?: string;
  referrer?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  viewport_w?: number;
  viewport_h?: number;
  locale?: string;
  session_id?: string;
  user_agent?: string;
}

/**
 * SA JSON key の必要 field だけ取り出した型。完全な GCP SA JSON にはこれ以外にも
 * project_id / client_id / auth_uri 等が入るが、本 module では使わない。
 *
 * @graph-connects none
 */
export interface SaCredentials {
  client_email: string;
  private_key: string;
}

/** @graph-connects none */
const TRACK_EVENT_TYPES = new Set(["page_view", "engagement", "share"]);

/** @graph-connects none */
const MAX_STRING_LEN = 512;

/** @graph-connects none */
const MAX_UA_LEN = 256;

/**
 * client payload を保守的に sanitize して TrackRow に整形する。文字列は MAX_STRING_LEN
 * で truncate、数値は 0–10000 の範囲 check、event_type は allowlist 強制。garbage を
 * BQ に流さないための fence。
 *
 * @graph-connects none
 */
export function buildTrackRow(input: TrackInput, userAgent: string | null): TrackRow | null {
  if (typeof input !== "object" || input === null) return null;
  if (typeof input.event_type !== "string") return null;
  if (!TRACK_EVENT_TYPES.has(input.event_type)) return null;
  const row: TrackRow = {
    ts: new Date().toISOString(),
    event_type: input.event_type,
  };
  const writable = row as unknown as Record<string, unknown>;
  const setString = (key: keyof TrackInput) => {
    const v = input[key];
    if (typeof v === "string" && v.length > 0) {
      writable[key] = v.slice(0, MAX_STRING_LEN);
    }
  };
  setString("path");
  setString("slug");
  setString("lang");
  setString("referrer");
  setString("utm_source");
  setString("utm_medium");
  setString("utm_campaign");
  setString("locale");
  setString("session_id");
  if (typeof input.viewport_w === "number" && input.viewport_w >= 0 && input.viewport_w <= 10000) {
    row.viewport_w = Math.floor(input.viewport_w);
  }
  if (typeof input.viewport_h === "number" && input.viewport_h >= 0 && input.viewport_h <= 10000) {
    row.viewport_h = Math.floor(input.viewport_h);
  }
  if (typeof userAgent === "string" && userAgent.length > 0) {
    row.user_agent = userAgent.slice(0, MAX_UA_LEN);
  }
  return row;
}

/**
 * PEM 形式の RSA 秘密鍵 (PKCS8) を SubtleCrypto.importKey で CryptoKey に変換する。
 *
 * GCP の SA JSON に入っている `private_key` は PEM 形式の base64 (PKCS8)。
 * 改行は LF と `\n` リテラルが混在しうるので両方剥がす。
 *
 * @graph-connects none
 */
export async function importSaPrivateKey(pem: string): Promise<CryptoKey> {
  // PEM の BEGIN/END マーカーは generic な regex で剥がす (リポジトリの secret-scan
  // パターンが PEM ヘッダー文字列の literal を誤検知するため、コード中には記述しない)
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\\n/g, "")
    .replace(/\s+/g, "");
  const binary = atob(b64);
  const der = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) der[i] = binary.charCodeAt(i);
  return await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/**
 * バイト列を base64url (RFC 4648 §5) でエンコードする。`+` → `-`、`/` → `_`、
 * padding `=` を削る。JWT の各 segment は base64url で連結する規約。
 *
 * @graph-connects none
 */
export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * RS256 で JWT を署名する。header / payload は JSON-stringify 後に base64url、
 * 連結文字列を SubtleCrypto.sign に渡して signature を取り、3 segment を `.` で繋ぐ。
 *
 * @graph-connects none
 */
export async function signJwt(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  key: CryptoKey,
): Promise<string> {
  const enc = new TextEncoder();
  const headerB64 = base64UrlEncode(enc.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(enc.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    enc.encode(signingInput),
  );
  return `${signingInput}.${base64UrlEncode(new Uint8Array(sig))}`;
}

/** @graph-connects none */
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

/** @graph-connects none */
const BQ_SCOPE = "https://www.googleapis.com/auth/bigquery.insertdata";

/**
 * SA credentials で OAuth2 access token を 1 つ取得する。caller 側で cache する。
 *
 * fetch impl は引数で受け取り、test では mock fetch を渡せるようにする。
 *
 * @graph-connects iam [calls] oauth2.googleapis.com/token で SA→access_token 交換
 */
export async function exchangeJwtForToken(
  sa: SaCredentials,
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessToken: string; expiresInSec: number }> {
  const key = await importSaPrivateKey(sa.private_key);
  const now = Math.floor(Date.now() / 1000);
  const jwt = await signJwt(
    { alg: "RS256", typ: "JWT" },
    {
      iss: sa.client_email,
      scope: BQ_SCOPE,
      aud: OAUTH_TOKEN_URL,
      exp: now + 3600,
      iat: now,
    },
    key,
  );
  const res = await fetchImpl(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });
  if (!res.ok) throw new Error(`oauth token exchange failed: ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  return { accessToken: data.access_token, expiresInSec: data.expires_in };
}

/**
 * Module-level token cache。Workers isolate 寿命中 1 つだけ持つ。expiry の 60 秒手前で
 * 失効扱いにして、reuse 中の token が in-flight request で expire するのを避ける。
 *
 * test 用に `_resetTokenCacheForTest` で reset 可能。
 *
 * @graph-connects none
 */
let cachedToken: { token: string; expiresAtMs: number } | null = null;

/**
 * 並行する cache miss を集約する in-flight promise。cold-start 直後に同 isolate で
 * 並列に来る N 個の `/api/track` が同時に OAuth 経路を踏むと N 本の token 交換
 * request が走るが、本 ref を共有することで「miss → exchange → cache fill」を
 * 1 回に圧縮する (thundering herd 抑止)。
 *
 * test 用に `_resetTokenCacheForTest` 内で同時に null クリアする。
 *
 * @graph-connects none
 */
let inFlightExchange: Promise<{ accessToken: string; expiresInSec: number }> | null = null;

/**
 * cache を見て fresh ならそれを返し、無ければ OAuth 経路を踏んで新 token を cache する。
 * cache miss が並行した場合は in-flight Promise を共有して OAuth 経路を 1 回に集約する。
 *
 * @graph-connects iam [calls] exchangeJwtForToken (cache miss 時のみ、並行時は共有)
 */
export async function getAccessToken(
  sa: SaCredentials,
  fetchImpl: typeof fetch = fetch,
  nowMs: () => number = Date.now,
): Promise<string> {
  if (cachedToken && cachedToken.expiresAtMs > nowMs() + 60_000) {
    return cachedToken.token;
  }
  inFlightExchange ??= exchangeJwtForToken(sa, fetchImpl);
  try {
    const { accessToken, expiresInSec } = await inFlightExchange;
    cachedToken = {
      token: accessToken,
      expiresAtMs: nowMs() + expiresInSec * 1000,
    };
    return accessToken;
  } finally {
    inFlightExchange = null;
  }
}

/** @graph-connects none */
export function _resetTokenCacheForTest(): void {
  cachedToken = null;
  inFlightExchange = null;
}

/**
 * BQ tabledata.insertAll REST API で 1+ 行を streaming insert する。
 *
 * `insertId` は重複検出 (BQ 側で 1 分窓に同 ID は dedup) のために row ごとに UUID。
 * `skipInvalidRows: false` で schema mismatch を fail-fast にし、`ignoreUnknownValues:
 * false` で typo / 想定外 key を弾く。
 *
 * @graph-connects bigquery [writes_to] projects/<id>/datasets/<dataset>/tables/<table>/insertAll
 */
export async function insertRows(
  args: {
    token: string;
    projectId: string;
    dataset: string;
    table: string;
    rows: TrackRow[];
  },
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${args.projectId}/datasets/${args.dataset}/tables/${args.table}/insertAll`;
  const body = {
    skipInvalidRows: false,
    ignoreUnknownValues: false,
    rows: args.rows.map((row) => ({
      insertId: crypto.randomUUID(),
      json: row,
    })),
  };
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`bq insertAll failed: ${res.status}`);
  const data = (await res.json()) as { insertErrors?: unknown[] };
  if (data.insertErrors && data.insertErrors.length > 0) {
    throw new Error(`bq insertAll partial failure: ${JSON.stringify(data.insertErrors)}`);
  }
}

/**
 * SA JSON 文字列を parse して必要 field を取り出す。`private_key` 内の `\n` literal は
 * そのまま PEM パーサが扱える形 (改行は importKey 内で削る) なので置換不要。
 *
 * @graph-connects none
 */
export function parseSaJson(raw: string): SaCredentials | null {
  try {
    const obj = JSON.parse(raw) as Partial<SaCredentials>;
    if (typeof obj.client_email !== "string" || typeof obj.private_key !== "string") return null;
    return { client_email: obj.client_email, private_key: obj.private_key };
  } catch {
    return null;
  }
}
