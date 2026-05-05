/**
 * `posts.ts` の unit test (fake fetch で全 pagination + node 構造を検証)。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business tweetSubtype / tweetToContentNode / personSeedNode / parseOwnPosts / parseAllOwnPosts の純粋ロジックと async pagination を network 無しで全網羅
 * @graph-connects none
 */

import { describe, expect, it, vi } from "vitest";
import { deterministicId } from "../../common/id.js";
import {
  parseAllOwnPosts,
  parseOwnPosts,
  personSeedNode,
  POSTS_SOURCE,
  tweetSubtype,
  tweetToContentNode,
  type XTweetRaw,
} from "./posts.js";
import { X_ACCOUNTS, personIdFor } from "./accounts.js";
import type { XCreds } from "./auth.js";
import type { FetchFn } from "./client.js";

const creds: XCreds = {
  consumerKey: "ck",
  consumerSecret: "cs",
  accessToken: "at",
  accessTokenSecret: "ats",
};

const ryantsuji = X_ACCOUNTS.find((a) => a.account === "ryantsuji")!;
const ryanaircloset = X_ACCOUNTS.find((a) => a.account === "ryanaircloset")!;

function fakeOk(body: unknown): ReturnType<FetchFn> {
  return Promise.resolve({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
    json: async () => body,
  });
}

describe("tweetSubtype", () => {
  it("returns 'tweet' for plain tweets (no referenced_tweets)", () => {
    expect(tweetSubtype({ id: "1", text: "hi" })).toBe("tweet");
  });

  it("returns 'reply' when referenced_tweets has replied_to", () => {
    expect(
      tweetSubtype({
        id: "1",
        text: "hi",
        referenced_tweets: [{ type: "replied_to", id: "2" }],
      }),
    ).toBe("reply");
  });

  it("returns 'quote' when referenced_tweets has quoted", () => {
    expect(
      tweetSubtype({
        id: "1",
        text: "hi",
        referenced_tweets: [{ type: "quoted", id: "2" }],
      }),
    ).toBe("quote");
  });

  it("returns 'retweet' when referenced_tweets has retweeted", () => {
    expect(
      tweetSubtype({
        id: "1",
        text: "RT @x: hi",
        referenced_tweets: [{ type: "retweeted", id: "2" }],
      }),
    ).toBe("retweet");
  });

  it("retweet wins over quote / reply when both are present", () => {
    expect(
      tweetSubtype({
        id: "1",
        text: "x",
        referenced_tweets: [
          { type: "replied_to", id: "2" },
          { type: "quoted", id: "3" },
          { type: "retweeted", id: "4" },
        ],
      }),
    ).toBe("retweet");
  });

  it("quote wins over reply when both are present (no retweet)", () => {
    expect(
      tweetSubtype({
        id: "1",
        text: "x",
        referenced_tweets: [
          { type: "replied_to", id: "2" },
          { type: "quoted", id: "3" },
        ],
      }),
    ).toBe("quote");
  });
});

describe("tweetToContentNode", () => {
  it("builds correct content node fields + url + deterministic id", () => {
    const t: XTweetRaw = {
      id: "999",
      text: "hello world",
      created_at: "2026-05-04T10:00:00.000Z",
      conversation_id: "999",
      lang: "en",
    };
    const personId = personIdFor(ryantsuji);
    const node = tweetToContentNode(t, ryantsuji, personId);
    expect(node.kind).toBe("contents");
    expect(node.id).toBe(deterministicId("x", "999"));
    expect(node.fields.content_id).toBe(node.id);
    expect(node.fields.source).toBe("x");
    expect(node.fields.external_id).toBe("999");
    expect(node.fields.url).toBe("https://x.com/ryantsuji/status/999");
    expect(node.fields.author_person_id).toBe(personId);
    expect(node.fields.published_at).toBe("2026-05-04T10:00:00.000Z");
    expect(node.body_summary).toBe("hello world");
  });

  it("title is slice(0,80) of single-line text (multiple whitespace collapsed)", () => {
    const t: XTweetRaw = {
      id: "1",
      text: "line1\nline2\n\nline3",
    };
    const node = tweetToContentNode(t, ryantsuji, "p");
    expect(node.fields.title).toBe("line1 line2 line3");
  });

  it("title is truncated to 80 chars for long tweets", () => {
    const t: XTweetRaw = { id: "1", text: "a".repeat(300) };
    const node = tweetToContentNode(t, ryantsuji, "p");
    expect((node.fields.title as string).length).toBe(80);
  });

  it("metadata.subtype mirrors tweetSubtype", () => {
    const t: XTweetRaw = {
      id: "1",
      text: "x",
      referenced_tweets: [{ type: "quoted", id: "2" }],
    };
    const node = tweetToContentNode(t, ryantsuji, "p");
    expect((node.metadata as { subtype: string }).subtype).toBe("quote");
  });

  it("falls back to account.language when tweet.lang is missing", () => {
    const t: XTweetRaw = { id: "1", text: "x" };
    const node = tweetToContentNode(t, ryanaircloset, "p");
    expect((node.metadata as { language: string }).language).toBe("ja");
  });

  it("uses different URL handle per account (case preserved in URL)", () => {
    const node = tweetToContentNode({ id: "1", text: "x" }, ryanaircloset, "p");
    expect(node.fields.url).toBe("https://x.com/RyanAircloset/status/1");
  });
});

describe("personSeedNode", () => {
  it("includes both x and x_id identifiers", () => {
    const personId = personIdFor(ryantsuji);
    const node = personSeedNode(ryantsuji, personId);
    expect(node.kind).toBe("persons");
    expect(node.id).toBe(personId);
    expect(node.fields.primary_handle).toBe("ryantsuji");
    const idents = node.fields.identifiers as Array<{ platform: string; value: string }>;
    expect(idents).toEqual(
      expect.arrayContaining([
        { platform: "x", value: "ryantsuji" },
        { platform: "x_id", value: "183196464" },
      ]),
    );
    expect(node.body_summary).toBe(ryantsuji.bio);
  });
});

describe("parseOwnPosts", () => {
  it("paginates through all pages and emits 1 contents node + 1 authored edge per tweet", async () => {
    const pages = [
      {
        data: [
          { id: "1", text: "first", created_at: "2026-01-01T00:00:00Z" },
          { id: "2", text: "second", created_at: "2026-01-02T00:00:00Z" },
        ],
        meta: { next_token: "p2" },
      },
      {
        data: [{ id: "3", text: "third", created_at: "2026-01-03T00:00:00Z" }],
        meta: {},
      },
    ];
    let i = 0;
    const fetcher = vi.fn().mockImplementation(() => fakeOk(pages[i++]));

    const result = await parseOwnPosts(ryantsuji, creds, { fetcher: fetcher as FetchFn });

    expect(result.source).toBe(`${POSTS_SOURCE}:ryantsuji`);
    // 1 person seed + 3 contents = 4 nodes
    expect(result.nodes).toHaveLength(4);
    expect(result.nodes[0].kind).toBe("persons");
    expect(result.nodes.slice(1).every((n) => n.kind === "contents")).toBe(true);
    // 3 authored edges (one per tweet)
    expect(result.edges).toHaveLength(3);
    expect(result.edges.every((e) => e.edge_type === "authored")).toBe(true);
    expect(result.edges.every((e) => e.src_kind === "persons")).toBe(true);
    expect(result.edges.every((e) => e.tgt_kind === "contents")).toBe(true);
    // 2 pages fetched
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("hits /2/users/{userId}/tweets path with required tweet.fields", async () => {
    const fetcher = vi.fn().mockReturnValue(fakeOk({ data: [], meta: {} }));
    await parseOwnPosts(ryantsuji, creds, { fetcher: fetcher as FetchFn });
    const url = fetcher.mock.calls[0][0] as string;
    expect(url).toContain("/2/users/183196464/tweets");
    expect(url).toContain("tweet.fields=");
    expect(url).toContain("max_results=100");
  });

  it("respects maxPages opts (stops early)", async () => {
    const fetcher = vi.fn().mockImplementation(() =>
      fakeOk({
        data: [{ id: "x", text: "x", created_at: "2026-01-01T00:00:00Z" }],
        meta: { next_token: "neverend" },
      }),
    );
    const result = await parseOwnPosts(ryantsuji, creds, {
      fetcher: fetcher as FetchFn,
      maxPages: 2,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    // 1 person + 2 tweets
    expect(result.nodes).toHaveLength(3);
  });
});

describe("parseAllOwnPosts", () => {
  it("invokes loadCreds for each account and concatenates ParseResult[]", async () => {
    const loadCreds = vi.fn().mockResolvedValue(creds);
    const fetcher = vi.fn().mockReturnValue(fakeOk({ data: [], meta: {} }));
    const results = await parseAllOwnPosts(loadCreds as (a: string) => Promise<XCreds>, {
      fetcher: fetcher as FetchFn,
    });
    expect(results).toHaveLength(2);
    expect(loadCreds).toHaveBeenCalledWith("ryantsuji");
    expect(loadCreds).toHaveBeenCalledWith("ryanaircloset");
    expect(results[0].source).toContain("ryantsuji");
    expect(results[1].source).toContain("ryanaircloset");
  });
});
