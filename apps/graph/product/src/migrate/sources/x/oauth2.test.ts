/**
 * `oauth2.ts` の unit test (in-memory cache + fake fetch + Secret Manager hook)。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business loadOAuth2AppCreds / loadOAuth2Tokens / isExpired / refreshTokens / getOAuth2Bearer の各 path を Secret Manager test cache + fake fetch で網羅。writeOAuth2Tokens は実 GCP 呼び出しになるので getOAuth2Bearer に writeBack:false を渡すパターンで検証
 * @graph-connects none
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _setSecretCacheForTest, clearSecretCache } from "@self/otel/secret";

// SecretManagerServiceClient の constructor を mock して default writer 経路を安全に exercise
const mockAddSecretVersion = vi.fn().mockResolvedValue(undefined);
vi.mock("@google-cloud/secret-manager", () => ({
  SecretManagerServiceClient: class {
    addSecretVersion = mockAddSecretVersion;
  },
}));
import {
  _setOAuth2CacheForTest,
  clearOAuth2Cache,
  getOAuth2Bearer,
  isExpired,
  loadOAuth2AppCreds,
  loadOAuth2Tokens,
  newDefaultSecretWriter,
  refreshTokens,
  writeOAuth2Tokens,
  type FetchFn,
  type SecretWriter,
  type XOAuth2Tokens,
} from "./oauth2.js";

const NOW = 1_700_000_000;

function fakeOk(body: unknown): ReturnType<FetchFn> {
  return Promise.resolve({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
    json: async () => body,
  });
}

function fakeErr(status: number, body: string): ReturnType<FetchFn> {
  return Promise.resolve({
    ok: false,
    status,
    text: async () => body,
    json: async () => ({}),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW * 1000);
  process.env.GOOGLE_CLOUD_PROJECT = "test-proj";
});

afterEach(() => {
  vi.useRealTimers();
  clearSecretCache();
  clearOAuth2Cache();
});

describe("cache hooks", () => {
  it("_setOAuth2CacheForTest(account, null) deletes cached entry", async () => {
    _setOAuth2CacheForTest("foo", { accessToken: "x", refreshToken: "y", expiresAt: NOW + 600 });
    _setOAuth2CacheForTest("foo", null);
    // After deletion, getOAuth2Bearer needs to load from SM
    _setSecretCacheForTest(
      "xmcp-user-foo-oauth2",
      JSON.stringify({
        X_OAUTH2_ACCESS_TOKEN: "from-sm",
        X_OAUTH2_REFRESH_TOKEN: "rt",
        X_OAUTH2_EXPIRES_AT: NOW + 600,
      }),
      "test-proj",
    );
    expect(await getOAuth2Bearer("foo", { project: "test-proj" })).toBe("from-sm");
  });
});

describe("loadOAuth2AppCreds", () => {
  it("returns clientId / clientSecret from xmcp-app-credentials", async () => {
    _setSecretCacheForTest(
      "xmcp-app-credentials",
      JSON.stringify({ X_CLIENT_ID: "ci", X_CLIENT_SECRET: "cs" }),
      "test-proj",
    );
    expect(await loadOAuth2AppCreds("test-proj")).toEqual({ clientId: "ci", clientSecret: "cs" });
  });

  it("throws when X_CLIENT_ID is missing", async () => {
    _setSecretCacheForTest(
      "xmcp-app-credentials",
      JSON.stringify({ X_CLIENT_SECRET: "cs" }),
      "test-proj",
    );
    await expect(loadOAuth2AppCreds("test-proj")).rejects.toThrow(/X_CLIENT_ID/);
  });
});

describe("loadOAuth2Tokens", () => {
  it("returns parsed access/refresh/expires", async () => {
    _setSecretCacheForTest(
      "xmcp-user-foo-oauth2",
      JSON.stringify({
        X_OAUTH2_ACCESS_TOKEN: "at",
        X_OAUTH2_REFRESH_TOKEN: "rt",
        X_OAUTH2_EXPIRES_AT: NOW + 7200,
      }),
      "test-proj",
    );
    const t = await loadOAuth2Tokens("foo", "test-proj");
    expect(t).toEqual({ accessToken: "at", refreshToken: "rt", expiresAt: NOW + 7200 });
  });

  it("throws when access_token missing", async () => {
    _setSecretCacheForTest(
      "xmcp-user-foo-oauth2",
      JSON.stringify({ X_OAUTH2_REFRESH_TOKEN: "rt", X_OAUTH2_EXPIRES_AT: 1 }),
      "test-proj",
    );
    await expect(loadOAuth2Tokens("foo", "test-proj")).rejects.toThrow(/X_OAUTH2_ACCESS_TOKEN/);
  });

  it("throws when refresh_token missing", async () => {
    _setSecretCacheForTest(
      "xmcp-user-foo-oauth2",
      JSON.stringify({ X_OAUTH2_ACCESS_TOKEN: "at", X_OAUTH2_EXPIRES_AT: 1 }),
      "test-proj",
    );
    await expect(loadOAuth2Tokens("foo", "test-proj")).rejects.toThrow(/X_OAUTH2_REFRESH_TOKEN/);
  });

  it("throws when expires_at not a number", async () => {
    _setSecretCacheForTest(
      "xmcp-user-foo-oauth2",
      JSON.stringify({ X_OAUTH2_ACCESS_TOKEN: "at", X_OAUTH2_REFRESH_TOKEN: "rt", X_OAUTH2_EXPIRES_AT: "bad" }),
      "test-proj",
    );
    await expect(loadOAuth2Tokens("foo", "test-proj")).rejects.toThrow(/X_OAUTH2_EXPIRES_AT/);
  });
});

describe("isExpired", () => {
  it("false when expires_at is well in the future", () => {
    expect(isExpired({ accessToken: "x", refreshToken: "y", expiresAt: NOW + 600 }, NOW)).toBe(false);
  });

  it("true within 60 sec buffer of expiry", () => {
    expect(isExpired({ accessToken: "x", refreshToken: "y", expiresAt: NOW + 30 }, NOW)).toBe(true);
  });

  it("true when expires_at is in the past", () => {
    expect(isExpired({ accessToken: "x", refreshToken: "y", expiresAt: NOW - 10 }, NOW)).toBe(true);
  });
});

describe("refreshTokens", () => {
  it("POSTs refresh_token grant + Basic auth and returns new tokens", async () => {
    const fetcher = vi
      .fn()
      .mockReturnValue(
        fakeOk({ access_token: "new-at", refresh_token: "new-rt", expires_in: 7200 }),
      );
    const result = await refreshTokens(
      { clientId: "ci", clientSecret: "cs" },
      "old-rt",
      fetcher as FetchFn,
    );
    expect(result.accessToken).toBe("new-at");
    expect(result.refreshToken).toBe("new-rt");
    expect(result.expiresAt).toBe(NOW + 7200);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.x.com/2/oauth2/token");
    const auth = (init as { headers: Record<string, string> }).headers.Authorization;
    expect(auth).toMatch(/^Basic /);
    expect(Buffer.from(auth.slice(6), "base64").toString("utf8")).toBe("ci:cs");
    expect((init as { body: string }).body).toContain("grant_type=refresh_token");
    expect((init as { body: string }).body).toContain("refresh_token=old-rt");
  });

  it("falls back to original refresh_token if response omits it", async () => {
    const fetcher = vi
      .fn()
      .mockReturnValue(fakeOk({ access_token: "new-at", expires_in: 7200 }));
    const result = await refreshTokens(
      { clientId: "ci", clientSecret: "cs" },
      "preserved-rt",
      fetcher as FetchFn,
    );
    expect(result.refreshToken).toBe("preserved-rt");
  });

  it("throws on non-2xx response with body excerpt", async () => {
    const fetcher = vi.fn().mockReturnValue(fakeErr(401, '{"detail":"bad"}'));
    await expect(
      refreshTokens({ clientId: "ci", clientSecret: "cs" }, "rt", fetcher as FetchFn),
    ).rejects.toThrow(/401.*bad/);
  });

  it("throws when access_token is missing", async () => {
    const fetcher = vi.fn().mockReturnValue(fakeOk({ refresh_token: "rt", expires_in: 7200 }));
    await expect(
      refreshTokens({ clientId: "ci", clientSecret: "cs" }, "rt", fetcher as FetchFn),
    ).rejects.toThrow(/access_token/);
  });

  it("throws when expires_in is missing", async () => {
    const fetcher = vi
      .fn()
      .mockReturnValue(fakeOk({ access_token: "at", refresh_token: "rt" }));
    await expect(
      refreshTokens({ clientId: "ci", clientSecret: "cs" }, "rt", fetcher as FetchFn),
    ).rejects.toThrow(/expires_in/);
  });

  it("throws when refresh_token in response is empty string", async () => {
    const fetcher = vi
      .fn()
      .mockReturnValue(
        fakeOk({ access_token: "at", refresh_token: "", expires_in: 7200 }),
      );
    await expect(
      refreshTokens({ clientId: "ci", clientSecret: "cs" }, "rt", fetcher as FetchFn),
    ).rejects.toThrow(/refresh_token/);
  });
});

describe("newDefaultSecretWriter", () => {
  it("returns an instance with addSecretVersion (mocked SecretManagerServiceClient)", () => {
    const w = newDefaultSecretWriter();
    expect(typeof w.addSecretVersion).toBe("function");
  });
});

describe("writeOAuth2Tokens", () => {
  it("encodes JSON payload with X_OAUTH2_* keys and writes to expected secret name", async () => {
    const writer: SecretWriter = { addSecretVersion: vi.fn().mockResolvedValue(undefined) };
    const tokens: XOAuth2Tokens = { accessToken: "a", refreshToken: "r", expiresAt: 123 };
    await writeOAuth2Tokens("foo", tokens, "test-proj", writer);
    const call = (writer.addSecretVersion as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      parent: string;
      payload: { data: Buffer };
    };
    expect(call.parent).toBe("projects/test-proj/secrets/xmcp-user-foo-oauth2");
    const decoded = JSON.parse(call.payload.data.toString("utf8"));
    expect(decoded).toEqual({
      X_OAUTH2_ACCESS_TOKEN: "a",
      X_OAUTH2_REFRESH_TOKEN: "r",
      X_OAUTH2_EXPIRES_AT: 123,
    });
  });

  it("falls back to default SecretManagerServiceClient when writer not provided", async () => {
    mockAddSecretVersion.mockClear();
    process.env.GOOGLE_CLOUD_PROJECT = "test-default-writer";
    await writeOAuth2Tokens("foo", { accessToken: "a", refreshToken: "r", expiresAt: 1 });
    expect(mockAddSecretVersion).toHaveBeenCalledTimes(1);
    const call = mockAddSecretVersion.mock.calls[0][0] as { parent: string };
    expect(call.parent).toContain("test-default-writer");
  });

  it("falls back to GOOGLE_CLOUD_PROJECT env when project not specified", async () => {
    const writer: SecretWriter = { addSecretVersion: vi.fn().mockResolvedValue(undefined) };
    process.env.GOOGLE_CLOUD_PROJECT = "env-proj";
    await writeOAuth2Tokens(
      "foo",
      { accessToken: "a", refreshToken: "r", expiresAt: 1 },
      undefined,
      writer,
    );
    const call = (writer.addSecretVersion as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      parent: string;
    };
    expect(call.parent).toContain("env-proj");
  });

  it("throws when project missing and env unset", async () => {
    const writer: SecretWriter = { addSecretVersion: vi.fn() };
    delete process.env.GOOGLE_CLOUD_PROJECT;
    await expect(
      writeOAuth2Tokens("foo", { accessToken: "a", refreshToken: "r", expiresAt: 1 }, undefined, writer),
    ).rejects.toThrow(/project/);
  });
});

describe("getOAuth2Bearer", () => {
  it("returns cached access_token when not expired", async () => {
    _setOAuth2CacheForTest("foo", { accessToken: "cached", refreshToken: "rt", expiresAt: NOW + 600 });
    expect(await getOAuth2Bearer("foo", { project: "test-proj" })).toBe("cached");
  });

  it("loads from Secret Manager when not cached", async () => {
    _setSecretCacheForTest(
      "xmcp-user-foo-oauth2",
      JSON.stringify({
        X_OAUTH2_ACCESS_TOKEN: "from-sm",
        X_OAUTH2_REFRESH_TOKEN: "rt",
        X_OAUTH2_EXPIRES_AT: NOW + 600,
      }),
      "test-proj",
    );
    expect(await getOAuth2Bearer("foo", { project: "test-proj" })).toBe("from-sm");
  });

  it("refreshes and caches when expired (writeBack:false)", async () => {
    _setSecretCacheForTest(
      "xmcp-app-credentials",
      JSON.stringify({ X_CLIENT_ID: "ci", X_CLIENT_SECRET: "cs" }),
      "test-proj",
    );
    _setSecretCacheForTest(
      "xmcp-user-foo-oauth2",
      JSON.stringify({
        X_OAUTH2_ACCESS_TOKEN: "old",
        X_OAUTH2_REFRESH_TOKEN: "rt",
        X_OAUTH2_EXPIRES_AT: NOW - 100, // expired
      }),
      "test-proj",
    );
    const fetcher = vi
      .fn()
      .mockReturnValue(
        fakeOk({ access_token: "fresh", refresh_token: "new-rt", expires_in: 7200 }),
      );
    const bearer = await getOAuth2Bearer("foo", {
      project: "test-proj",
      fetcher: fetcher as FetchFn,
      writeBack: false,
    });
    expect(bearer).toBe("fresh");
    // 2 度目の呼び出しは cache から (fetcher は 1 回だけ)
    expect(await getOAuth2Bearer("foo", { project: "test-proj", writeBack: false })).toBe("fresh");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("calls writeOAuth2Tokens via writer when writeBack is true (default)", async () => {
    _setSecretCacheForTest(
      "xmcp-app-credentials",
      JSON.stringify({ X_CLIENT_ID: "ci", X_CLIENT_SECRET: "cs" }),
      "test-proj",
    );
    _setSecretCacheForTest(
      "xmcp-user-foo-oauth2",
      JSON.stringify({
        X_OAUTH2_ACCESS_TOKEN: "old",
        X_OAUTH2_REFRESH_TOKEN: "rt",
        X_OAUTH2_EXPIRES_AT: NOW - 100,
      }),
      "test-proj",
    );
    const fetcher = vi
      .fn()
      .mockReturnValue(
        fakeOk({ access_token: "new", refresh_token: "new-rt", expires_in: 7200 }),
      );
    const writer: SecretWriter = { addSecretVersion: vi.fn().mockResolvedValue(undefined) };
    await getOAuth2Bearer("foo", {
      project: "test-proj",
      fetcher: fetcher as FetchFn,
      writer,
    });
    expect(writer.addSecretVersion).toHaveBeenCalledTimes(1);
    const call = (writer.addSecretVersion as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      parent: string;
      payload: { data: Buffer };
    };
    expect(call.parent).toContain("xmcp-user-foo-oauth2");
    const decoded = JSON.parse(call.payload.data.toString("utf8"));
    expect(decoded.X_OAUTH2_ACCESS_TOKEN).toBe("new");
  });

  it("uses cached tokens for refresh path when cache exists but expired", async () => {
    _setSecretCacheForTest(
      "xmcp-app-credentials",
      JSON.stringify({ X_CLIENT_ID: "ci", X_CLIENT_SECRET: "cs" }),
      "test-proj",
    );
    _setOAuth2CacheForTest("foo", {
      accessToken: "old",
      refreshToken: "rt-cached",
      expiresAt: NOW - 100,
    });
    const fetcher = vi
      .fn()
      .mockReturnValue(
        fakeOk({ access_token: "refreshed", refresh_token: "rt-new", expires_in: 1 }),
      );
    const bearer = await getOAuth2Bearer("foo", {
      project: "test-proj",
      fetcher: fetcher as FetchFn,
      writeBack: false,
    });
    expect(bearer).toBe("refreshed");
    // refresh_token in body は cached を使う
    const init = fetcher.mock.calls[0][1] as { body: string };
    expect(init.body).toContain("refresh_token=rt-cached");
  });
});
