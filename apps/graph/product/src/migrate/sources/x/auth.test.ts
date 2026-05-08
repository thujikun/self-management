/**
 * `auth.ts` の unit test。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business rfc3986Encode / buildOAuth1Header / loadXCreds の純粋ロジック検証。Secret Manager は @self/otel の test hook で in-memory cache に inject
 * @graph-connects none
 */

import { afterEach, describe, expect, it } from "vitest";
import { _setSecretCacheForTest, clearSecretCache } from "@self/otel/secret";
import { buildOAuth1Header, loadXCreds, rfc3986Encode, type XCreds } from "./auth.js";

const fixedCreds: XCreds = {
  consumerKey: "ck",
  consumerSecret: "cs",
  accessToken: "at",
  accessTokenSecret: "ats",
};

describe("rfc3986Encode", () => {
  it("encodes RFC 3986 reserved chars correctly", () => {
    // encodeURIComponent では encode されない 5 文字を上乗せ encode する
    expect(rfc3986Encode("!*'()")).toBe("%21%2A%27%28%29");
  });

  it("preserves unreserved chars", () => {
    expect(rfc3986Encode("ABCabc012-_.~")).toBe("ABCabc012-_.~");
  });

  it("encodes space as %20 (not '+')", () => {
    expect(rfc3986Encode("a b")).toBe("a%20b");
  });

  it("encodes Japanese / multi-byte", () => {
    expect(rfc3986Encode("辻")).toBe("%E8%BE%BB");
  });
});

describe("buildOAuth1Header", () => {
  it("contains all required oauth_* fields", () => {
    const h = buildOAuth1Header(
      "GET",
      "https://api.x.com/2/users/me",
      fixedCreds,
      {},
      {
        nonce: "n1",
        timestamp: "1700000000",
      },
    );
    expect(h).toMatch(/^OAuth /);
    for (const k of [
      "oauth_consumer_key",
      "oauth_nonce",
      "oauth_signature",
      "oauth_signature_method",
      "oauth_timestamp",
      "oauth_token",
      "oauth_version",
    ]) {
      expect(h).toContain(`${k}=`);
    }
  });

  it("is deterministic given fixed nonce/timestamp", () => {
    const a = buildOAuth1Header(
      "GET",
      "https://api.x.com/2/users/me",
      fixedCreds,
      {},
      {
        nonce: "n",
        timestamp: "1700000000",
      },
    );
    const b = buildOAuth1Header(
      "GET",
      "https://api.x.com/2/users/me",
      fixedCreds,
      {},
      {
        nonce: "n",
        timestamp: "1700000000",
      },
    );
    expect(a).toBe(b);
  });

  it("signature changes when consumer_secret changes", () => {
    const a = buildOAuth1Header(
      "GET",
      "https://x",
      fixedCreds,
      {},
      {
        nonce: "n",
        timestamp: "1",
      },
    );
    const b = buildOAuth1Header(
      "GET",
      "https://x",
      { ...fixedCreds, consumerSecret: "different" },
      {},
      { nonce: "n", timestamp: "1" },
    );
    const sigA = a.match(/oauth_signature="([^"]+)"/)?.[1];
    const sigB = b.match(/oauth_signature="([^"]+)"/)?.[1];
    expect(sigA).toBeDefined();
    expect(sigB).toBeDefined();
    expect(sigA).not.toBe(sigB);
  });

  it("signature changes when query params change (params included in base string)", () => {
    const a = buildOAuth1Header(
      "GET",
      "https://x",
      fixedCreds,
      { foo: "1" },
      {
        nonce: "n",
        timestamp: "1",
      },
    );
    const b = buildOAuth1Header(
      "GET",
      "https://x",
      fixedCreds,
      { foo: "2" },
      {
        nonce: "n",
        timestamp: "1",
      },
    );
    const sigA = a.match(/oauth_signature="([^"]+)"/)?.[1];
    const sigB = b.match(/oauth_signature="([^"]+)"/)?.[1];
    expect(sigA).not.toBe(sigB);
  });

  it("query params do NOT appear in Authorization header (only signature is affected)", () => {
    const h = buildOAuth1Header(
      "GET",
      "https://x",
      fixedCreds,
      { max_results: "100" },
      { nonce: "n", timestamp: "1" },
    );
    expect(h).not.toContain("max_results");
  });

  it("auto-generates nonce / timestamp when omitted", () => {
    const a = buildOAuth1Header("GET", "https://x", fixedCreds);
    const b = buildOAuth1Header("GET", "https://x", fixedCreds);
    // 自動生成 nonce / timestamp は変わるはずなので 2 回呼びで signature が変わる
    expect(a).not.toBe(b);
  });

  it("signs with method case-insensitively (POST = post in base string)", () => {
    const a = buildOAuth1Header(
      "post",
      "https://x",
      fixedCreds,
      {},
      {
        nonce: "n",
        timestamp: "1",
      },
    );
    const b = buildOAuth1Header(
      "POST",
      "https://x",
      fixedCreds,
      {},
      {
        nonce: "n",
        timestamp: "1",
      },
    );
    expect(a).toBe(b);
  });
});

describe("loadXCreds", () => {
  afterEach(() => clearSecretCache());

  it("merges app + user secrets and returns 4 fields", async () => {
    _setSecretCacheForTest(
      "xmcp-app-credentials",
      JSON.stringify({
        X_OAUTH_CONSUMER_KEY: "CK",
        X_OAUTH_CONSUMER_SECRET: "CS",
      }),
      "p1",
    );
    _setSecretCacheForTest(
      "xmcp-user-ryantsuji",
      JSON.stringify({
        X_OAUTH_ACCESS_TOKEN: "AT",
        X_OAUTH_ACCESS_TOKEN_SECRET: "ATS",
      }),
      "p1",
    );
    const c = await loadXCreds("ryantsuji", "p1");
    expect(c).toEqual({
      consumerKey: "CK",
      consumerSecret: "CS",
      accessToken: "AT",
      accessTokenSecret: "ATS",
    });
  });

  it("throws when a required key is missing", async () => {
    _setSecretCacheForTest(
      "xmcp-app-credentials",
      JSON.stringify({ X_OAUTH_CONSUMER_KEY: "CK" }),
      "p2",
    );
    _setSecretCacheForTest(
      "xmcp-user-foo",
      JSON.stringify({
        X_OAUTH_ACCESS_TOKEN: "AT",
        X_OAUTH_ACCESS_TOKEN_SECRET: "ATS",
      }),
      "p2",
    );
    await expect(loadXCreds("foo", "p2")).rejects.toThrow(/X_OAUTH_CONSUMER_SECRET/);
  });

  it("throws when secret payload is not valid JSON", async () => {
    _setSecretCacheForTest("xmcp-app-credentials", "not-json", "p3");
    _setSecretCacheForTest(
      "xmcp-user-foo",
      JSON.stringify({
        X_OAUTH_ACCESS_TOKEN: "AT",
        X_OAUTH_ACCESS_TOKEN_SECRET: "ATS",
      }),
      "p3",
    );
    await expect(loadXCreds("foo", "p3")).rejects.toThrow(/not valid JSON/);
  });

  it("throws when secret payload is JSON array (not object)", async () => {
    _setSecretCacheForTest("xmcp-app-credentials", "[1,2,3]", "p4");
    _setSecretCacheForTest(
      "xmcp-user-foo",
      JSON.stringify({
        X_OAUTH_ACCESS_TOKEN: "AT",
        X_OAUTH_ACCESS_TOKEN_SECRET: "ATS",
      }),
      "p4",
    );
    await expect(loadXCreds("foo", "p4")).rejects.toThrow(/not a JSON object/);
  });
});
