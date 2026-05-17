/**
 * bq-track.ts の test。
 *
 * Web Crypto (SubtleCrypto) は happy-dom が Node の webcrypto に委譲してくれるので、
 * RS256 鍵を `generateKey` で 1 度だけ作って test 内で actual sign / verify を踏める。
 * BQ / OAuth の network call は `fetchImpl` 引数で mock 関数を差し込む形にして、
 * 実際の HTTP 経路には出さない。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business BQ track helper の単体 test。Web Crypto で生成した RSA 鍵で JWT 署名 / verify を実機に流し、OAuth / BQ insertAll は fetch mock で経路を網羅。`buildTrackRow` の sanitize / truncate / allowlist と token cache の挙動も全 case 押さえる
 * @graph-connects none
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetTokenCacheForTest,
  base64UrlEncode,
  buildTrackRow,
  exchangeJwtForToken,
  getAccessToken,
  insertRows,
  parseSaJson,
  signJwt,
  type SaCredentials,
} from "./bq-track.js";

/**
 * test 用 RSA 鍵 + PEM 文字列。SubtleCrypto.generateKey で 1 回だけ作って全 test 間で
 * reuse。`exportKey("pkcs8")` で DER に出して PEM 文字列に整形する (`parseSaJson` →
 * `importSaPrivateKey` の経路を経由できるよう PEM format に揃える)。
 */
let testPublicKey: CryptoKey;
let testPemPrivateKey: string;

const PEM_LINE_LEN = 64;

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  testPublicKey = pair.publicKey;
  const der = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const bytes = new Uint8Array(der);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  const b64 = btoa(bin);
  const wrapped = b64.match(new RegExp(`.{1,${PEM_LINE_LEN}}`, "g"))!.join("\n");
  testPemPrivateKey = `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----\n`;
});

describe("buildTrackRow", () => {
  it("event_type allowlist 外は null", () => {
    expect(buildTrackRow({ event_type: "random_event" }, null)).toBeNull();
    expect(buildTrackRow({ event_type: "" }, null)).toBeNull();
  });

  it("allowlist 内は ts + event_type で row を返す", () => {
    const row = buildTrackRow({ event_type: "page_view" }, null);
    expect(row).not.toBeNull();
    expect(row!.event_type).toBe("page_view");
    expect(new Date(row!.ts).getTime()).not.toBeNaN();
  });

  it("文字列 field は 512 文字に truncate", () => {
    const longPath = "/x/".repeat(300);
    const row = buildTrackRow({ event_type: "page_view", path: longPath }, null);
    expect(row!.path!.length).toBe(512);
  });

  it("user_agent は 256 文字に truncate", () => {
    const ua = "Mozilla".repeat(300);
    const row = buildTrackRow({ event_type: "page_view" }, ua);
    expect(row!.user_agent!.length).toBe(256);
  });

  it("viewport_w / viewport_h は範囲外を弾く", () => {
    expect(
      buildTrackRow({ event_type: "page_view", viewport_w: -1 }, null)!.viewport_w,
    ).toBeUndefined();
    expect(
      buildTrackRow({ event_type: "page_view", viewport_w: 99999 }, null)!.viewport_w,
    ).toBeUndefined();
    expect(buildTrackRow({ event_type: "page_view", viewport_w: 1920.7 }, null)!.viewport_w).toBe(
      1920,
    );
  });

  it("非 object input は null", () => {
    expect(buildTrackRow(null as unknown as never, null)).toBeNull();
    expect(buildTrackRow("string" as unknown as never, null)).toBeNull();
  });
});

describe("base64UrlEncode", () => {
  it("`+` `/` `=` を url-safe 形に置換する", () => {
    // 「subjects?」(プレーン base64 で `+` `/` `=` を含むペイロード)
    const bytes = new Uint8Array([0xfb, 0xff, 0xbf, 0xfa]);
    const encoded = base64UrlEncode(bytes);
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");
  });

  it("空配列は空文字", () => {
    expect(base64UrlEncode(new Uint8Array(0))).toBe("");
  });
});

describe("signJwt + importSaPrivateKey", () => {
  it("PEM 鍵を import して JWT を署名、3 segment 構造 + verify 通過", async () => {
    const { importSaPrivateKey } = await import("./bq-track.js");
    const privKey = await importSaPrivateKey(testPemPrivateKey);
    const jwt = await signJwt(
      { alg: "RS256", typ: "JWT" },
      { iss: "test@example.iam.gserviceaccount.com", iat: 1700000000, exp: 1700003600 },
      privKey,
    );
    const segments = jwt.split(".");
    expect(segments).toHaveLength(3);

    // verify signature with public key — RS256 / SHA-256
    const enc = new TextEncoder();
    const data = enc.encode(`${segments[0]}.${segments[1]}`);
    // base64url の signature を bytes に decode
    const sigB64 = segments[2]!.replace(/-/g, "+").replace(/_/g, "/");
    const pad = sigB64.length % 4 === 0 ? "" : "=".repeat(4 - (sigB64.length % 4));
    const sigBin = atob(sigB64 + pad);
    const sig = new Uint8Array(sigBin.length);
    for (let i = 0; i < sigBin.length; i++) sig[i] = sigBin.charCodeAt(i);
    const ok = await crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, testPublicKey, sig, data);
    expect(ok).toBe(true);
  });
});

describe("exchangeJwtForToken", () => {
  it("OAuth 200 + access_token を accessToken / expiresInSec に詰めて返す", async () => {
    const sa: SaCredentials = {
      client_email: "graph-app@ryan-self-management.iam.gserviceaccount.com",
      private_key: testPemPrivateKey,
    };
    const fetchMock = vi.fn(
      async (_url: URL | RequestInfo, _init?: RequestInit) =>
        new Response(JSON.stringify({ access_token: "ya29.abc", expires_in: 3600 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const out = await exchangeJwtForToken(sa, fetchMock as unknown as typeof fetch);
    expect(out.accessToken).toBe("ya29.abc");
    expect(out.expiresInSec).toBe(3600);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect((init as RequestInit).method).toBe("POST");
  });

  it("OAuth 非 200 で throw", async () => {
    const sa: SaCredentials = { client_email: "x@x.iam", private_key: testPemPrivateKey };
    const fetchMock = vi.fn(async () => new Response("bad", { status: 400 }));
    await expect(exchangeJwtForToken(sa, fetchMock as unknown as typeof fetch)).rejects.toThrow(
      /oauth token exchange failed: 400/,
    );
  });
});

describe("getAccessToken token cache", () => {
  const sa: SaCredentials = {
    client_email: "graph-app@x.iam.gserviceaccount.com",
    private_key: "",
  };

  beforeEach(() => {
    _resetTokenCacheForTest();
    sa.private_key = testPemPrivateKey;
  });
  afterEach(() => _resetTokenCacheForTest());

  it("cache miss → OAuth 経路 → cache hit で 2 回目は OAuth 呼ばない", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ access_token: "t1", expires_in: 3600 }), { status: 200 }),
    );
    const now = vi.fn(() => 1_700_000_000_000);
    const t1 = await getAccessToken(sa, fetchMock as unknown as typeof fetch, now);
    const t2 = await getAccessToken(sa, fetchMock as unknown as typeof fetch, now);
    expect(t1).toBe("t1");
    expect(t2).toBe("t1");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("expiry 60 秒手前を過ぎたら refresh", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ access_token: "t-new", expires_in: 3600 }), { status: 200 }),
    );
    let now = 1_700_000_000_000;
    await getAccessToken(sa, fetchMock as unknown as typeof fetch, () => now);
    now += 3600 * 1000 - 30_000; // ~30 秒前 (= cache invalid)
    await getAccessToken(sa, fetchMock as unknown as typeof fetch, () => now);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("insertRows", () => {
  const baseArgs = {
    token: "ya29.test",
    projectId: "ryan-self-management",
    dataset: "ryan",
    table: "web_events",
    rows: [{ ts: "2026-05-17T00:00:00Z", event_type: "page_view" }],
  };

  it("200 + insertErrors 空なら resolve", async () => {
    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({}), { status: 200 }),
    );
    await expect(
      insertRows(baseArgs, fetchMock as unknown as typeof fetch),
    ).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/datasets/ryan/tables/web_events/insertAll");
    expect((init as RequestInit).headers as Record<string, string>).toMatchObject({
      Authorization: "Bearer ya29.test",
    });
  });

  it("非 200 で throw", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 403 }));
    await expect(insertRows(baseArgs, fetchMock as unknown as typeof fetch)).rejects.toThrow(
      /bq insertAll failed: 403/,
    );
  });

  it("insertErrors 付き 200 でも throw (partial failure を成功扱いしない)", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ insertErrors: [{ index: 0 }] }), { status: 200 }),
    );
    await expect(insertRows(baseArgs, fetchMock as unknown as typeof fetch)).rejects.toThrow(
      /bq insertAll partial failure/,
    );
  });
});

describe("parseSaJson", () => {
  it("有効な JSON は credentials を返す", () => {
    const json = JSON.stringify({
      type: "service_account",
      client_email: "x@x.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
    });
    expect(parseSaJson(json)).toStrictEqual({
      client_email: "x@x.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
    });
  });

  it("JSON parse 失敗は null", () => {
    expect(parseSaJson("not json")).toBeNull();
  });

  it("必須 field 欠落は null", () => {
    expect(parseSaJson(JSON.stringify({ client_email: "x@x" }))).toBeNull();
    expect(parseSaJson(JSON.stringify({ private_key: "x" }))).toBeNull();
  });
});
