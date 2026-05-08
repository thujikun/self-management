/**
 * `back-references.ts` の unit test (fake fetch + sleep inject)。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business fetchBackRefsForTweet / parseBackReferences / extractOwnTweetRefs / deterministicContentIdForTweet の純粋ロジックを fake fetch + sleep で網羅。throttle / maxTweets / 失敗時 skip の挙動を検証
 * @graph-connects none
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { deterministicId } from "../../common/id.js";
import { PERSON_SOURCE } from "./accounts.js";
import { _setOAuth2CacheForTest, clearOAuth2Cache } from "./oauth2.js";
import {
  defaultBearerProvider,
  defaultSleep,
  deterministicContentIdForTweet,
  extractOwnTweetRefs,
  fetchBackRefsForTweet,
  parseBackReferences,
  type OwnTweetRef,
} from "./back-references.js";
import type { FetchFn } from "./client.js";
import type { NodeInput } from "../../common/types.js";

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
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("defaultBearerProvider", () => {
  it("returns function that delegates to getOAuth2Bearer (cache-injected)", async () => {
    _setOAuth2CacheForTest("ryantsuji", {
      accessToken: "from-cache",
      refreshToken: "rt",
      expiresAt: Math.floor(Date.now() / 1000) + 600,
    });
    const provider = defaultBearerProvider("test-proj");
    expect(await provider("ryantsuji")).toBe("from-cache");
    clearOAuth2Cache();
  });
});

describe("defaultSleep", () => {
  it("resolves after the given ms (using fake timers)", async () => {
    vi.useFakeTimers();
    const promise = defaultSleep(100);
    let resolved = false;
    promise.then(() => {
      resolved = true;
    });
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    await promise;
    expect(resolved).toBe(true);
    vi.useRealTimers();
  });
});

describe("deterministicContentIdForTweet", () => {
  it("matches deterministicId('x', tweetId)", () => {
    expect(deterministicContentIdForTweet("123")).toBe(deterministicId("x", "123"));
  });
});

describe("fetchBackRefsForTweet", () => {
  const ref: OwnTweetRef = {
    tweetId: "T1",
    ownContentId: deterministicId("x", "T1"),
    account: "ryantsuji",
  };

  it("retweeted_by → external person + engaged_with(repost) edge", async () => {
    const fetcher = vi.fn().mockImplementation((url: string) => {
      if (url.includes("retweeted_by")) {
        return fakeOk({
          data: [{ id: "u1", username: "RT_User", name: "RT", description: "bio" }],
        });
      }
      return fakeOk({ data: [], includes: {} });
    });
    const out = await fetchBackRefsForTweet(ref, "BEAR", fetcher as FetchFn);
    expect(out.nodes.filter((n) => n.kind === "persons")).toHaveLength(1);
    const e = out.edges.find((e) => e.edge_type === "engaged_with");
    expect(e).toBeDefined();
    const props = e!.properties as { engagement: string };
    expect(props.engagement).toBe("repost");
    expect(e!.tgt_id).toBe(ref.ownContentId);
  });

  it("quote_tweets → external content + person seed + quoted + authored edges", async () => {
    const fetcher = vi.fn().mockImplementation((url: string) => {
      if (url.includes("retweeted_by")) return fakeOk({ data: [] });
      return fakeOk({
        data: [
          { id: "Q1", text: "quoting Ryan", created_at: "2026-01-01T00:00:00Z", author_id: "u9" },
        ],
        includes: { users: [{ id: "u9", username: "Quoter" }] },
      });
    });
    const out = await fetchBackRefsForTweet(ref, "BEAR", fetcher as FetchFn);
    const personNodes = out.nodes.filter((n) => n.kind === "persons");
    const contentNodes = out.nodes.filter((n) => n.kind === "contents");
    expect(personNodes).toHaveLength(1);
    expect(contentNodes).toHaveLength(1);
    const quoted = out.edges.find((e) => e.edge_type === "quoted");
    expect(quoted).toBeDefined();
    expect(quoted!.tgt_id).toBe(ref.ownContentId);
    const authored = out.edges.find((e) => e.edge_type === "authored");
    expect(authored).toBeDefined();
    expect(authored!.src_id).toBe(deterministicId(PERSON_SOURCE, "quoter"));
  });

  it("filters out malformed retweet user entries (missing id or username)", async () => {
    const fetcher = vi.fn().mockImplementation((url: string) => {
      if (url.includes("retweeted_by")) {
        return fakeOk({
          data: [
            { id: "u1", username: "Good" },
            { id: "", username: "BadId" },
            { id: "u2" }, // missing username
          ],
        });
      }
      return fakeOk({ data: [], includes: {} });
    });
    const out = await fetchBackRefsForTweet(ref, "BEAR", fetcher as FetchFn);
    const persons = out.nodes.filter((n) => n.kind === "persons");
    expect(persons).toHaveLength(1);
    expect(persons[0].fields.primary_handle).toBe("Good");
  });

  it("handles missing data field in quote_tweets response (defaults to [])", async () => {
    const fetcher = vi.fn().mockImplementation((url: string) => {
      if (url.includes("retweeted_by")) return fakeOk({ data: [] });
      // quote_tweets response with NO data field
      return fakeOk({ includes: {} });
    });
    const out = await fetchBackRefsForTweet(ref, "BEAR", fetcher as FetchFn);
    expect(out.nodes).toEqual([]);
    expect(out.edges).toEqual([]);
  });

  it("handles quote tweet with no author (no authored edge)", async () => {
    const fetcher = vi.fn().mockImplementation((url: string) => {
      if (url.includes("retweeted_by")) return fakeOk({ data: [] });
      return fakeOk({
        data: [{ id: "Q1", text: "anon quote" }],
        includes: { users: [] },
      });
    });
    const out = await fetchBackRefsForTweet(ref, "BEAR", fetcher as FetchFn);
    const authored = out.edges.find((e) => e.edge_type === "authored");
    expect(authored).toBeUndefined();
    const quoted = out.edges.find((e) => e.edge_type === "quoted");
    expect(quoted).toBeDefined();
  });
});

describe("parseBackReferences", () => {
  const sleep = vi.fn().mockResolvedValue(undefined);
  const ownTweets: OwnTweetRef[] = [
    { tweetId: "T1", ownContentId: deterministicId("x", "T1"), account: "ryantsuji" },
    { tweetId: "T2", ownContentId: deterministicId("x", "T2"), account: "ryantsuji" },
    { tweetId: "T3", ownContentId: deterministicId("x", "T3"), account: "ryanaircloset" },
  ];

  it("iterates all tweets, calls bearerProvider once per account, throttles between", async () => {
    const fetcher = vi.fn().mockReturnValue(fakeOk({ data: [], includes: {} }));
    const bearerProvider = vi.fn().mockResolvedValue("B");
    const result = await parseBackReferences(ownTweets, {
      fetcher: fetcher as FetchFn,
      bearerProvider,
      sleep,
      throttleMs: 100,
    });
    expect(result.source).toBe("x_back_references");
    // 3 tweets × 2 endpoints = 6 fetch calls
    expect(fetcher).toHaveBeenCalledTimes(6);
    // 2 unique accounts → 2 bearerProvider calls
    expect(bearerProvider.mock.calls.map((c) => c[0]).sort()).toEqual([
      "ryanaircloset",
      "ryantsuji",
    ]);
    // throttle: 3 tweets → 2 sleeps (last skipped)
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("respects maxTweets (slice from front)", async () => {
    const fetcher = vi.fn().mockReturnValue(fakeOk({ data: [], includes: {} }));
    const bearerProvider = vi.fn().mockResolvedValue("B");
    await parseBackReferences(ownTweets, {
      fetcher: fetcher as FetchFn,
      bearerProvider,
      sleep,
      throttleMs: 0,
      maxTweets: 1,
    });
    expect(fetcher).toHaveBeenCalledTimes(2); // 1 tweet × 2 endpoints
  });

  it("isolates per-tweet failures (404 on T2 doesn't stop T3)", async () => {
    const fetcher = vi.fn().mockImplementation((url: string) => {
      // T2 の retweeted_by request で 404
      if (url.includes("/2/tweets/T2/retweeted_by")) return fakeErr(404, "not found");
      return fakeOk({ data: [], includes: {} });
    });
    const bearerProvider = vi.fn().mockResolvedValue("B");
    const r = await parseBackReferences(ownTweets, {
      fetcher: fetcher as FetchFn,
      bearerProvider,
      sleep,
      throttleMs: 0,
    });
    // T1 / T3 は成功、T2 は warn + skip。T1 = 2 fetch、T2 = 1 (failed)、T3 = 2 fetch = 5 total
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(r.source).toBe("x_back_references");
  });

  it("default sleep / throttleMs branch is reachable (no inject for either)", async () => {
    // sleep / throttleMs を両方 inject しないことで defaultSleep + 15000 default の
    // branch (line 171/172) を踏む。fake timers で時計を飛ばす
    vi.useFakeTimers();
    const fetcher = vi.fn().mockReturnValue(fakeOk({ data: [], includes: {} }));
    const bearerProvider = vi.fn().mockResolvedValue("B");
    const promise = parseBackReferences(ownTweets.slice(0, 2), {
      fetcher: fetcher as FetchFn,
      bearerProvider,
    });
    // default throttle = 15_000ms。1 個目→ throttle → 2 個目
    await vi.advanceTimersByTimeAsync(15_000);
    await promise;
    expect(fetcher).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });

  it("non-Error thrown from fetchBackRefsForTweet is stringified in warn message", async () => {
    const fetcher = vi.fn().mockImplementation(() => {
      // エラーを Error 以外 (string) で reject させる
      return Promise.reject("string-error");
    });
    const bearerProvider = vi.fn().mockResolvedValue("B");
    const r = await parseBackReferences(ownTweets.slice(0, 1), {
      fetcher: fetcher as FetchFn,
      bearerProvider,
      sleep,
      throttleMs: 0,
    });
    expect(r.nodes).toEqual([]);
    expect(r.edges).toEqual([]);
  });
});

describe("extractOwnTweetRefs", () => {
  it("extracts only x_post contents with both external_id and account", () => {
    const nodes: NodeInput[] = [
      {
        kind: "contents",
        id: deterministicId("x", "T1"),
        fields: { external_id: "T1" },
        metadata: { source: "x_post", account: "ryantsuji" },
      },
      {
        kind: "contents",
        id: deterministicId("x", "T2"),
        fields: { external_id: "T2" },
        metadata: { source: "x_post", account: "RyanAircloset" },
      },
      {
        kind: "contents",
        id: "skip-non-x",
        fields: { external_id: "X" },
        metadata: { source: "operations-log" },
      },
      {
        kind: "persons",
        id: "skip-person",
        fields: {},
      },
      {
        kind: "contents",
        id: "skip-no-account",
        fields: { external_id: "T3" },
        metadata: { source: "x_post" }, // missing account
      },
      {
        kind: "contents",
        id: "skip-no-external-id",
        fields: {}, // missing external_id
        metadata: { source: "x_post", account: "ryantsuji" },
      },
      {
        // metadata=null: should be skipped (not crash)
        kind: "contents",
        id: "skip-null-meta",
        fields: { external_id: "T-null" },
        metadata: null,
      },
    ];
    const refs = extractOwnTweetRefs(nodes);
    expect(refs).toHaveLength(2);
    expect(refs[0].account).toBe("ryantsuji");
    // 2 番目の content は account="RyanAircloset" (大文字混ざり) だが ryanaircloset に正規化される
    expect(refs[1].account).toBe("ryanaircloset");
  });
});
