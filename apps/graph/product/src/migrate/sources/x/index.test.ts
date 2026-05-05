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
  it("skipEngagements=true で own posts のみ取り込む", async () => {
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
      skipEngagements: true,
    });

    expect(result.source).toBe("x");
    // 2 person seeds + 2 tweets = 4 nodes
    expect(result.nodes).toHaveLength(4);
    expect(result.edges).toHaveLength(2);
    const externalIds = result.nodes
      .filter((n) => n.kind === "contents")
      .map((n) => n.fields.external_id);
    expect(externalIds).toEqual(
      expect.arrayContaining(["ryantsuji-1", "ryanaircloset-1"]),
    );
    expect(loadCreds).toHaveBeenCalledTimes(2);
    // 2 own posts call のみ (engagement 各 endpoint は呼ばない)
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("default で own posts + 全 engagement type を fetch (2*3 = 6 endpoint hit)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const loadCreds = vi.fn().mockResolvedValue(fakeCreds);
    const fetcher = vi.fn().mockReturnValue(
      Promise.resolve({
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({ data: [], meta: {} }),
      }),
    );
    const result = await parseX(loadCreds as (a: string) => Promise<XCreds>, {
      fetcher: fetcher as FetchFn,
    });
    expect(result.source).toBe("x");
    // own posts × 2 accounts = 2、engagement (mention + like) × 2 accounts = 4、合計 6
    expect(fetcher).toHaveBeenCalledTimes(6);
    // person seeds 2 個のみ (data は全部空)
    expect(result.nodes.filter((n) => n.kind === "persons")).toHaveLength(2);
    vi.restoreAllMocks();
  });

  it("engagementTypes で取り込む type を限定できる", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const loadCreds = vi.fn().mockResolvedValue(fakeCreds);
    const fetcher = vi.fn().mockReturnValue(
      Promise.resolve({
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({ data: [], meta: {} }),
      }),
    );
    await parseX(loadCreds as (a: string) => Promise<XCreds>, {
      fetcher: fetcher as FetchFn,
      engagementTypes: ["like"],
    });
    // own posts × 2 = 2、like × 2 accounts = 2、合計 4
    expect(fetcher).toHaveBeenCalledTimes(4);
    vi.restoreAllMocks();
  });

  it("default で referenced_tweets から content→content edges を派生", async () => {
    const loadCreds = vi.fn().mockResolvedValue(fakeCreds);
    let calls = 0;
    const fetcher = vi.fn().mockImplementation(() => {
      // 1 件目: replied_to を持つ own post
      const data = calls++ === 0
        ? [{
            id: "tweet1",
            text: "reply",
            created_at: "2026-01-01T00:00:00Z",
            referenced_tweets: [{ type: "replied_to", id: "original" }],
          }]
        : [];
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({ data, meta: {} }),
      });
    });
    const result = await parseX(loadCreds as (a: string) => Promise<XCreds>, {
      fetcher: fetcher as FetchFn,
      skipEngagements: true,
    });
    // authored edge (1 件) + replied_to edge (1 件)
    expect(result.edges).toHaveLength(2);
    const types = result.edges.map((e) => e.edge_type).sort();
    expect(types).toEqual(["authored", "replied_to"]);
  });

  it("skipReferencedEdges=true で referenced edge を作らない", async () => {
    const loadCreds = vi.fn().mockResolvedValue(fakeCreds);
    let calls = 0;
    const fetcher = vi.fn().mockImplementation(() => {
      const data = calls++ === 0
        ? [{
            id: "tweet1",
            text: "reply",
            created_at: "2026-01-01T00:00:00Z",
            referenced_tweets: [{ type: "replied_to", id: "original" }],
          }]
        : [];
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({ data, meta: {} }),
      });
    });
    const result = await parseX(loadCreds as (a: string) => Promise<XCreds>, {
      fetcher: fetcher as FetchFn,
      skipEngagements: true,
      skipReferencedEdges: true,
    });
    // authored edge のみ (1 件)
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].edge_type).toBe("authored");
  });

  it("falls back to default loadXCreds (Secret Manager) when no loadCreds is provided", async () => {
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

    const result = await parseX(undefined, {
      fetcher: fetcher as FetchFn,
      skipEngagements: true,
    });
    // 2 person seeds (両アカウント)、tweet 0
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
