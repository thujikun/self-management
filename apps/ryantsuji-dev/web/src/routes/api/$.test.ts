/**
 * `/api/*` catch-all (Hono 委譲) のユニット test。
 *
 * TanStack Start の Route bundle を経由せず、export 済の Hono `app` instance を
 * 直接 `app.fetch(Request)` で叩いて handler を網羅する。Route export 自体も
 * オブジェクトとして実体化されることを確認することで、import の副作用ぶんだけは
 * coverage を稼ぐ (server.handlers の中身は TanStack Start 側でしか起動できないため
 * 単体では invoke せず、Hono 側 (`app`) を SSoT として網羅する)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business /api/* catch-all の handler 群を Hono app 経由で直接 fetch して網羅。CF Workers / TanStack Start runtime に依存せず unit test として完結し、ルーティングと response 形式の regression を取る
 * @graph-connects none
 */

import { SpanStatusCode, type Span } from "@opentelemetry/api";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetTokenCacheForTest } from "../../server/bq-track.js";
import type { Env } from "../../start.js";
import { app, recordTrackFailureOn, Route } from "./$.js";

/**
 * /api/track happy-path / fail-path 用の SA JSON を 1 度だけ生成する。Web Crypto で
 * RSA 鍵を作って PKCS8 → PEM 形式に整え、SA JSON の `private_key` field に詰める。
 * 同 PEM があれば `parseSaJson` → `importSaPrivateKey` → JWT 署名まで実機 path で通る。
 */
const PEM_LINE_LEN = 64;
let saJson: string;

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
  const der = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const bytes = new Uint8Array(der);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  const b64 = btoa(bin);
  const wrapped = b64.match(new RegExp(`.{1,${PEM_LINE_LEN}}`, "g"))!.join("\n");
  const pem = `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----\n`;
  saJson = JSON.stringify({
    type: "service_account",
    client_email: "graph-app@ryan-self-management.iam.gserviceaccount.com",
    private_key: pem,
  });
});

/**
 * Hono handler は `context.env` を読むので、TanStack Start runtime 不在の test では
 * 最低限の Env shape (optional field のみ空 string で埋める) を fake binding として
 * 渡す。`/track` は `GCP_SA_JSON` 不在で 204 早期 return するため副作用 0。
 */
const FAKE_CONTEXT = {
  env: {
    ASSETS: {} as Fetcher,
    IMAGES: {} as R2Bucket,
    DATABASE_URL: "",
    BETTER_AUTH_SECRET: "",
    BETTER_AUTH_URL: "",
    GITHUB_CLIENT_ID: "",
    GITHUB_CLIENT_SECRET: "",
    X_OAUTH2_CLIENT_ID: "",
    X_OAUTH2_CLIENT_SECRET: "",
    GOOGLE_CLIENT_ID: "",
    GOOGLE_CLIENT_SECRET: "",
  } satisfies Env,
};

describe("/api/$ — Hono app", () => {
  it("GET /api/health は 200 + status:ok を返す", async () => {
    const res = await app.fetch(new Request("http://example.test/api/health"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);

    const data = (await res.json()) as { status: string; service: string; timestamp: string };
    expect(data.status).toBe("ok");
    expect(data.service).toBe("ryantsuji-dev-web");
    expect(typeof data.timestamp).toBe("string");
    expect(new Date(data.timestamp).getTime()).not.toBeNaN();
  });

  it("未定義の path は 404 を返す", async () => {
    const res = await app.fetch(new Request("http://example.test/api/nonexistent"));
    expect(res.status).toBe(404);
  });

  it("Route.options.server.handlers.GET も同じ Hono response を返す", async () => {
    const opts = Route.options as {
      server?: {
        handlers?: Record<
          string,
          | ((ctx: { request: Request; context: { env: Env } }) => Promise<Response> | Response)
          | undefined
        >;
      };
    };
    const get = opts.server?.handlers?.GET;
    if (typeof get !== "function")
      throw new Error("Route.options.server.handlers.GET is not a function");

    const res = await get({
      request: new Request("http://example.test/api/health"),
      context: FAKE_CONTEXT,
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { status: string };
    expect(data.status).toBe("ok");
  });

  it("POST /api/track は GCP_SA_JSON 不在で 204 (fail-open)", async () => {
    const res = await app.fetch(
      new Request("http://example.test/api/track", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event_type: "page_view", path: "/" }),
      }),
      FAKE_CONTEXT.env,
    );
    expect(res.status).toBe(204);
  });
});

describe("/api/$ — POST /api/track (env 揃った経路)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    _resetTokenCacheForTest();
  });
  afterEach(() => {
    _resetTokenCacheForTest();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function envWithSa(overrides: Partial<Env> = {}): Env {
    return {
      ASSETS: {} as Fetcher,
      IMAGES: {} as R2Bucket,
      DATABASE_URL: "",
      BETTER_AUTH_SECRET: "",
      BETTER_AUTH_URL: "",
      GITHUB_CLIENT_ID: "",
      GITHUB_CLIENT_SECRET: "",
      X_OAUTH2_CLIENT_ID: "",
      X_OAUTH2_CLIENT_SECRET: "",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      GCP_SA_JSON: saJson,
      BQ_PROJECT_ID: "ryan-self-management",
      ...overrides,
    } satisfies Env;
  }

  it("happy-path: SA + input 揃いで OAuth → BQ insertAll が 1 回ずつ叩かれ 204", async () => {
    const fetchSpy = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "ya29.test", expires_in: 3600 }), {
          status: 200,
        });
      }
      if (String(url).includes("/insertAll")) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${String(url)}`);
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const res = await app.fetch(
      new Request("http://example.test/api/track", {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "ua-fixture/1.0" },
        body: JSON.stringify({ event_type: "page_view", path: "/posts/hello" }),
      }),
      envWithSa(),
    );
    expect(res.status).toBe(204);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const insertCall = fetchSpy.mock.calls.find(([u]) => String(u).includes("/insertAll"))!;
    expect(String(insertCall[0])).toContain(
      "/projects/ryan-self-management/datasets/ryan/tables/web_events/insertAll",
    );
  });

  it("broken SA JSON は 204 を返しつつ OAuth/BQ には到達しない", async () => {
    const fetchSpy = vi.fn(async () => new Response("nope", { status: 500 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const res = await app.fetch(
      new Request("http://example.test/api/track", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event_type: "page_view" }),
      }),
      envWithSa({ GCP_SA_JSON: "{not json" }),
    );
    expect(res.status).toBe(204);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("body が JSON でない (parse 失敗) → 204 で OAuth/BQ にも行かない", async () => {
    const fetchSpy = vi.fn(async () => new Response("nope", { status: 500 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const res = await app.fetch(
      new Request("http://example.test/api/track", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json-body",
      }),
      envWithSa(),
    );
    expect(res.status).toBe(204);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("event_type が allowlist 外 (buildTrackRow が null) → 204 で BQ には行かない", async () => {
    const fetchSpy = vi.fn(async () => new Response("nope", { status: 500 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const res = await app.fetch(
      new Request("http://example.test/api/track", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event_type: "random_garbage" }),
      }),
      envWithSa(),
    );
    expect(res.status).toBe(204);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("OAuth token exchange が落ちても 204 を返す (catch 経路)", async () => {
    const fetchSpy = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response("oauth boom", { status: 500 }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const res = await app.fetch(
      new Request("http://example.test/api/track", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event_type: "page_view", path: "/" }),
      }),
      envWithSa(),
    );
    expect(res.status).toBe(204);
    // OAuth へ 1 回だけ叩いて、insertAll までは到達しない
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(String(fetchSpy.mock.calls[0]![0])).toContain("oauth2.googleapis.com/token");
  });

  it("insertAll が 5xx 落ちでも 204 を返す (catch 経路)", async () => {
    const fetchSpy = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), {
          status: 200,
        });
      }
      return new Response("insert boom", { status: 500 });
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const res = await app.fetch(
      new Request("http://example.test/api/track", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event_type: "page_view", path: "/" }),
      }),
      envWithSa(),
    );
    expect(res.status).toBe(204);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("recordTrackFailureOn", () => {
  function makeFakeSpan(): {
    span: Span;
    addEvent: ReturnType<typeof vi.fn>;
    setStatus: ReturnType<typeof vi.fn>;
  } {
    const addEvent = vi.fn();
    const setStatus = vi.fn();
    // 必要最小限の Span shape (本 helper は addEvent / setStatus しか触らない)
    const span = { addEvent, setStatus } as unknown as Span;
    return { span, addEvent, setStatus };
  }

  it("span 不在 (undefined) は no-op", () => {
    // throw しなければ OK。spy は当然呼ばれない
    recordTrackFailureOn(undefined, "parse-sa-json");
  });

  it("Error instance を渡すと name / message を attrs に詰める", () => {
    const { span, addEvent, setStatus } = makeFakeSpan();
    const err = new TypeError("token bad");
    recordTrackFailureOn(span, "oauth-or-insert", err);
    expect(addEvent).toHaveBeenCalledExactlyOnceWith("track.bq.fail", {
      reason: "oauth-or-insert",
      "error.name": "TypeError",
      "error.message": "token bad",
    });
    expect(setStatus).toHaveBeenCalledExactlyOnceWith({
      code: SpanStatusCode.ERROR,
      message: "track.bq.fail:oauth-or-insert",
    });
  });

  it("Error 以外 (= 非 Error) は attrs に error.* を載せない", () => {
    const { span, addEvent, setStatus } = makeFakeSpan();
    recordTrackFailureOn(span, "parse-input", "string-thrown-not-error");
    expect(addEvent).toHaveBeenCalledExactlyOnceWith("track.bq.fail", {
      reason: "parse-input",
    });
    expect(setStatus).toHaveBeenCalledExactlyOnceWith({
      code: SpanStatusCode.ERROR,
      message: "track.bq.fail:parse-input",
    });
  });

  it("err 引数 未指定 (build-row 等の sync 経路) も成立する", () => {
    const { span, addEvent, setStatus } = makeFakeSpan();
    recordTrackFailureOn(span, "build-row");
    expect(addEvent).toHaveBeenCalledExactlyOnceWith("track.bq.fail", { reason: "build-row" });
    expect(setStatus).toHaveBeenCalledOnce();
  });
});
