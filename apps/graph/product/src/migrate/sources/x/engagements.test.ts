/**
 * `engagements.ts` の unit test (4 engagement type 全部 + 失敗 path)。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business ENGAGEMENT_CONFIGS の 4 type 全部の path / edge_type / engagement 値、parseEngagements の content+person+edge 構築、parseAllEngagements の失敗時 fallback と types フィルタを検証
 * @graph-connects none
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ENGAGEMENT_CONFIGS,
  parseAllEngagements,
  parseEngagements,
  type EngagementType,
} from "./engagements.js";
import { X_ACCOUNTS, personIdFor } from "./accounts.js";
import type { XCreds } from "./auth.js";
import type { FetchFn } from "./client.js";

const fakeCreds: XCreds = {
  consumerKey: "ck",
  consumerSecret: "cs",
  accessToken: "at",
  accessTokenSecret: "ats",
};
const ryantsuji = X_ACCOUNTS.find((a) => a.account === "ryantsuji")!;

function fakeOk(body: unknown): ReturnType<FetchFn> {
  return Promise.resolve({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
    json: async () => body,
  });
}

describe("ENGAGEMENT_CONFIGS", () => {
  it.each<[EngagementType, string, string, string, "oauth1" | "oauth2"]>([
    ["mention", "/2/users/U/mentions", "mentioned_in", "mention", "oauth1"],
    ["like", "/2/users/U/liked_tweets", "engaged_with", "like", "oauth1"],
    ["bookmark", "/2/users/U/bookmarks", "engaged_with", "bookmark", "oauth2"],
  ])("%s → path/edge/engagement/auth", (type, expectedPath, edge, eng, auth) => {
    const c = ENGAGEMENT_CONFIGS[type];
    expect(c.path("U")).toBe(expectedPath);
    expect(c.edgeType).toBe(edge);
    expect(c.engagement).toBe(eng);
    expect(c.auth).toBe(auth);
  });
});

describe("parseEngagements", () => {
  it("emits content + person seeds + edge per tweet (mention)", async () => {
    const fetcher = vi.fn().mockReturnValue(
      fakeOk({
        data: [
          {
            id: "t1",
            text: "hey @ryantsuji",
            created_at: "2026-01-01T00:00:00Z",
            author_id: "u1",
          },
        ],
        includes: {
          users: [
            { id: "u1", username: "External", name: "External User", description: "bio" },
          ],
        },
        meta: {},
      }),
    );
    const r = await parseEngagements(ryantsuji, fakeCreds, "mention", {
      fetcher: fetcher as FetchFn,
    });
    expect(r.source).toBe("x_mention:ryantsuji");
    // 1 content + 1 external person
    expect(r.nodes).toHaveLength(2);
    expect(r.nodes.some((n) => n.kind === "contents")).toBe(true);
    expect(r.nodes.some((n) => n.kind === "persons")).toBe(true);
    expect(r.edges).toHaveLength(1);
    expect(r.edges[0].edge_type).toBe("mentioned_in");
    expect(r.edges[0].src_id).toBe(personIdFor(ryantsuji));
  });

  it("attaches engagement='like' in edge.properties for like type", async () => {
    const fetcher = vi.fn().mockReturnValue(
      fakeOk({
        data: [{ id: "t1", text: "hi", author_id: "u1" }],
        includes: { users: [{ id: "u1", username: "X" }] },
        meta: {},
      }),
    );
    const r = await parseEngagements(ryantsuji, fakeCreds, "like", {
      fetcher: fetcher as FetchFn,
    });
    expect(r.edges).toHaveLength(1);
    const props = r.edges[0].properties as { engagement: string; account: string };
    expect(props.engagement).toBe("like");
    expect(props.account).toBe("ryantsuji");
    expect(r.edges[0].edge_type).toBe("engaged_with");
  });

  it("hits the correct path per engagement type", async () => {
    const fetcher = vi.fn().mockReturnValue(fakeOk({ data: [], meta: {} }));
    await parseEngagements(ryantsuji, fakeCreds, "like", {
      fetcher: fetcher as FetchFn,
    });
    const url = fetcher.mock.calls[0][0] as string;
    expect(url).toContain(`/2/users/${ryantsuji.userId}/liked_tweets`);
    expect(url).toContain("expansions=author_id");
  });

  it("filters out malformed user entries (missing id or username)", async () => {
    const fetcher = vi.fn().mockReturnValue(
      fakeOk({
        data: [{ id: "t1", text: "hi", author_id: "u1" }],
        includes: {
          users: [
            { id: "u1", username: "Good" },
            { id: "", username: "BadId" },
            { id: "u2" }, // missing username
          ],
        },
        meta: {},
      }),
    );
    const r = await parseEngagements(ryantsuji, fakeCreds, "like", {
      fetcher: fetcher as FetchFn,
    });
    const persons = r.nodes.filter((n) => n.kind === "persons");
    expect(persons).toHaveLength(1);
    expect(persons[0].fields.primary_handle).toBe("Good");
  });

  it("returns empty result when no data returned", async () => {
    const fetcher = vi.fn().mockReturnValue(fakeOk({ data: [], meta: {} }));
    const r = await parseEngagements(ryantsuji, fakeCreds, "mention", {
      fetcher: fetcher as FetchFn,
    });
    expect(r.nodes).toEqual([]);
    expect(r.edges).toEqual([]);
  });

  it("bookmark falls back to default getOAuth2Bearer when no bearerProvider (uses SM cache)", async () => {
    const { _setSecretCacheForTest, clearSecretCache } = await import("@self/otel/secret");
    const { _setOAuth2CacheForTest, clearOAuth2Cache } = await import("./oauth2.js");
    clearSecretCache();
    clearOAuth2Cache();
    process.env.GOOGLE_CLOUD_PROJECT = "test-bookmark-default";
    _setOAuth2CacheForTest("ryantsuji", {
      accessToken: "from-cache",
      refreshToken: "rt",
      expiresAt: Math.floor(Date.now() / 1000) + 600,
    });
    const fetcher = vi.fn().mockReturnValue(fakeOk({ data: [], meta: {} }));
    await parseEngagements(ryantsuji, fakeCreds, "bookmark", {
      fetcher: fetcher as FetchFn,
      project: "test-bookmark-default",
    });
    const init = fetcher.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe("Bearer from-cache");
    clearOAuth2Cache();
  });

  it("bookmark uses OAuth2 Bearer auth via bearerProvider injection", async () => {
    const fetcher = vi.fn().mockReturnValue(
      fakeOk({
        data: [{ id: "b1", text: "bookmarked", author_id: "u1" }],
        includes: { users: [{ id: "u1", username: "Ext" }] },
        meta: {},
      }),
    );
    const bearerProvider = vi.fn().mockResolvedValue("BEARER123");
    const r = await parseEngagements(ryantsuji, fakeCreds, "bookmark", {
      fetcher: fetcher as FetchFn,
      bearerProvider,
    });
    expect(bearerProvider).toHaveBeenCalledWith("ryantsuji");
    const init = fetcher.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe("Bearer BEARER123");
    expect(r.edges).toHaveLength(1);
    const props = r.edges[0].properties as { engagement: string };
    expect(props.engagement).toBe("bookmark");
  });
});

describe("parseAllEngagements", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("invokes loadCreds per account and runs each requested type", async () => {
    const loadCreds = vi.fn().mockResolvedValue(fakeCreds);
    const fetcher = vi.fn().mockReturnValue(fakeOk({ data: [], meta: {} }));
    const out = await parseAllEngagements(loadCreds as (a: string) => Promise<XCreds>, {
      fetcher: fetcher as FetchFn,
      types: ["mention", "like"],
    });
    // 2 accounts × 2 types = 4 results
    expect(out).toHaveLength(4);
    expect(out.map((r) => r.source).sort()).toEqual([
      "x_like:ryanaircloset",
      "x_like:ryantsuji",
      "x_mention:ryanaircloset",
      "x_mention:ryantsuji",
    ]);
    expect(loadCreds).toHaveBeenCalledTimes(2);
  });

  it("defaults to all 3 supported types (mention + like + bookmark) when types not provided", async () => {
    const loadCreds = vi.fn().mockResolvedValue(fakeCreds);
    const fetcher = vi.fn().mockReturnValue(fakeOk({ data: [], meta: {} }));
    const bearerProvider = vi.fn().mockResolvedValue("BEAR");
    const out = await parseAllEngagements(loadCreds as (a: string) => Promise<XCreds>, {
      fetcher: fetcher as FetchFn,
      bearerProvider,
    });
    // 2 accounts × 3 types = 6 results
    expect(out).toHaveLength(6);
  });

  it("isolates failures: 1 type error → empty result for that combo, others continue", async () => {
    const loadCreds = vi.fn().mockResolvedValue(fakeCreds);
    let i = 0;
    const fetcher = vi.fn().mockImplementation(() => {
      // 2nd call (= ryantsuji × like) で 401 失敗
      if (i++ === 1) {
        return Promise.resolve({
          ok: false,
          status: 401,
          text: async () => "Unauthorized",
          json: async () => ({}),
        });
      }
      return fakeOk({
        data: [{ id: `t${i}`, text: "x", author_id: "u1" }],
        includes: { users: [{ id: "u1", username: "U" }] },
        meta: {},
      });
    });
    const out = await parseAllEngagements(loadCreds as (a: string) => Promise<XCreds>, {
      fetcher: fetcher as FetchFn,
      types: ["mention", "like"],
    });
    // 4 results 全部返ってくる (失敗分は空)
    expect(out).toHaveLength(4);
    const failed = out.find((r) => r.source === "x_like:ryantsuji")!;
    expect(failed.nodes).toEqual([]);
    expect(failed.edges).toEqual([]);
    // 他は正常 (1 content + 1 person + 1 edge each)
    const others = out.filter((r) => r.source !== "x_like:ryantsuji");
    for (const r of others) {
      expect(r.nodes.length).toBeGreaterThan(0);
    }
  });
});
