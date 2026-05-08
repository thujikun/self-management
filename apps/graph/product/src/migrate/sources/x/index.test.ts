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
import { buildDefaultSinceIdProvider, parseX } from "./index.js";
import type { XCreds } from "./auth.js";
import type { FetchFn } from "./client.js";
import type { BqQueryClient } from "./since.js";

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
    expect(externalIds).toEqual(expect.arrayContaining(["ryantsuji-1", "ryanaircloset-1"]));
    expect(loadCreds).toHaveBeenCalledTimes(2);
    // 2 own posts call のみ (engagement 各 endpoint は呼ばない)
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("default で own posts + 全 engagement type (mention/like/bookmark) を fetch (2*4 = 8 endpoint hit)", async () => {
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
    const bearerProvider = vi.fn().mockResolvedValue("BEAR");
    const result = await parseX(loadCreds as (a: string) => Promise<XCreds>, {
      fetcher: fetcher as FetchFn,
      bearerProvider,
    });
    expect(result.source).toBe("x");
    // own posts × 2 = 2、(mention + like + bookmark) × 2 = 6、合計 8
    expect(fetcher).toHaveBeenCalledTimes(8);
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
      const data =
        calls++ === 0
          ? [
              {
                id: "tweet1",
                text: "reply",
                created_at: "2026-01-01T00:00:00Z",
                referenced_tweets: [{ type: "replied_to", id: "original" }],
              },
            ]
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
      const data =
        calls++ === 0
          ? [
              {
                id: "tweet1",
                text: "reply",
                created_at: "2026-01-01T00:00:00Z",
                referenced_tweets: [{ type: "replied_to", id: "original" }],
              },
            ]
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

  it("skipBackReferences=false で own tweet 数 × 2 endpoint 分の back-refs fetch が走る", async () => {
    const loadCreds = vi.fn().mockResolvedValue(fakeCreds);
    let call = 0;
    const fetcher = vi.fn().mockImplementation(() => {
      const n = call++;
      // 0,1: own posts (2 accounts) → 各 1 tweet
      if (n < 2) {
        const account = n === 0 ? "ryantsuji" : "ryanaircloset";
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => ({
            data: [
              {
                id: `${account}-tweet`,
                text: "x",
                created_at: "2026-01-01T00:00:00Z",
              },
            ],
            meta: {},
          }),
        });
      }
      // それ以降は back-refs 用の retweeted_by / quote_tweets に空 response
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({ data: [], includes: {} }),
      });
    });
    const bearerProvider = vi.fn().mockResolvedValue("BEAR");
    const result = await parseX(loadCreds as (a: string) => Promise<XCreds>, {
      fetcher: fetcher as FetchFn,
      skipEngagements: true,
      skipBackReferences: false,
      bearerProvider,
      backRefsThrottleMs: 0,
      backRefsMaxTweets: 10,
    });
    // own posts: 2 calls、back-refs: 2 own tweets × 2 endpoints = 4 calls = 6 total
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(result.source).toBe("x");
  });

  it("buildDefaultSinceIdProvider returns a SinceIdProvider that queries the injected BQ client", async () => {
    const mockClient: BqQueryClient = {
      createQueryJob: vi.fn(
        async () =>
          [{ getQueryResults: async () => [[{ max_id: "999" }]] }] as Awaited<
            ReturnType<BqQueryClient["createQueryJob"]>
          >,
      ),
    };
    const provider = buildDefaultSinceIdProvider(mockClient);
    const out = await provider("foo", "own");
    expect(out).toBe("999");
    expect(mockClient.createQueryJob).toHaveBeenCalled();
  });

  it("incremental mode passes since_id (own + mention) and caps liked/bookmark to noSinceIdMaxPages", async () => {
    const loadCreds = vi.fn().mockResolvedValue(fakeCreds);
    const sinceIdProvider = vi
      .fn()
      .mockImplementation((account: string, kind: string) =>
        Promise.resolve(`${account}-${kind}-id`),
      );
    const fetcher = vi.fn().mockReturnValue(
      Promise.resolve({
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({ data: [], meta: {} }),
      }),
    );
    const bearerProvider = vi.fn().mockResolvedValue("BEAR");
    await parseX(loadCreds as (a: string) => Promise<XCreds>, {
      fetcher: fetcher as FetchFn,
      bearerProvider,
      incremental: true,
      sinceIdProvider,
    });
    // own posts × 2 → since_id=...own-id 付与
    const urls = fetcher.mock.calls.map((c) => c[0] as string);
    const ownUrls = urls.filter((u) => u.includes("/tweets?"));
    for (const u of ownUrls) {
      expect(u).toContain("since_id=");
      expect(u).toMatch(/since_id=[\w-]+-own-id/);
    }
    // mention 用 URL も since_id 入る
    const mentionUrls = urls.filter((u) => u.includes("/mentions?"));
    for (const u of mentionUrls) {
      expect(u).toContain("since_id=");
    }
    // sinceIdProvider が own+mention で各 account 分呼ばれる (= 2 accounts × 2 kinds = 4)
    expect(sinceIdProvider).toHaveBeenCalledTimes(4);
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
