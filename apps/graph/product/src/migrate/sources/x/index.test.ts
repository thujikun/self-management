/**
 * `index.ts` (parseX 統合 entry) の unit test。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business parseX が両アカウント分の own posts を ParseResult に flatten すること、loadCreds inject が機能することの検証
 * @graph-connects none
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { _setSecretCacheForTest, clearSecretCache } from "@self/otel/secret";
import { parseX } from "./index.js";
import type { XCreds } from "./auth.js";
import type { FetchFn } from "./client.js";

const fakeCreds: XCreds = {
  consumerKey: "ck",
  consumerSecret: "cs",
  accessToken: "at",
  accessTokenSecret: "ats",
};

afterEach(() => clearSecretCache());

describe("parseX", () => {
  it("merges both accounts into a single ParseResult with source='x'", async () => {
    const loadCreds = vi.fn().mockResolvedValue(fakeCreds);
    let calls = 0;
    const fetcher = vi.fn().mockImplementation(() => {
      const account = calls++ === 0 ? "ryantsuji" : "ryanaircloset";
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({
          data: [
            {
              id: `${account}-1`,
              text: `tweet from ${account}`,
              created_at: "2026-01-01T00:00:00Z",
            },
          ],
          meta: {},
        }),
      });
    });

    const result = await parseX(loadCreds as (a: string) => Promise<XCreds>, {
      fetcher: fetcher as FetchFn,
    });

    expect(result.source).toBe("x");
    // 2 person seeds + 2 tweets = 4 nodes
    expect(result.nodes).toHaveLength(4);
    // 2 authored edges
    expect(result.edges).toHaveLength(2);
    // 両アカウント分が flatten されてる
    const externalIds = result.nodes
      .filter((n) => n.kind === "contents")
      .map((n) => n.fields.external_id);
    expect(externalIds).toEqual(
      expect.arrayContaining(["ryantsuji-1", "ryanaircloset-1"]),
    );
    expect(loadCreds).toHaveBeenCalledTimes(2);
  });

  it("falls back to default loadXCreds (Secret Manager) when no loadCreds is provided", async () => {
    // 両アカウント分の secret を cache に inject (project は GOOGLE_CLOUD_PROJECT=ryan-self-management)
    process.env.GOOGLE_CLOUD_PROJECT = "ryan-self-management";
    const appJson = JSON.stringify({
      X_OAUTH_CONSUMER_KEY: "CK",
      X_OAUTH_CONSUMER_SECRET: "CS",
    });
    const userJson = JSON.stringify({
      X_OAUTH_ACCESS_TOKEN: "AT",
      X_OAUTH_ACCESS_TOKEN_SECRET: "ATS",
    });
    _setSecretCacheForTest("xmcp-app-credentials", appJson);
    _setSecretCacheForTest("xmcp-user-ryantsuji", userJson);
    _setSecretCacheForTest("xmcp-user-ryanaircloset", userJson);

    const fetcher = vi.fn().mockReturnValue(
      Promise.resolve({
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({ data: [], meta: {} }),
      }),
    );

    const result = await parseX(undefined, { fetcher: fetcher as FetchFn });
    // 2 person seeds (両アカウント)、tweet 0
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
