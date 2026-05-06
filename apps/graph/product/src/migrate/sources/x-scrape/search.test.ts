/**
 * `search.ts` の unit test (synthetic fixture-based)。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business tweetToRaw / uniqueAuthors / searchAdapter の網羅。
 * 外部 person seed + content node + authored / references edge 生成、self-ref
 * 除外、handle 単位 dedupe を検証
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";
import { deterministicId } from "../../common/id.js";
import { searchAdapter, tweetToRaw, uniqueAuthors } from "./search.js";
import type { SearchScrapeData, SearchScrapeTweet } from "./types.js";

function tweet(overrides: Partial<SearchScrapeTweet> = {}): SearchScrapeTweet {
  return {
    tweet_id: "1234567890",
    user_handle: "alice",
    user_display: "Alice",
    text: "great article! 2731787582881a",
    created_at: "2026-04-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("tweetToRaw", () => {
  it("maps SearchScrapeTweet → XTweetWithAuthor preserving id/text/created_at and using handle as author_id", () => {
    const raw = tweetToRaw(
      tweet({ tweet_id: "9", user_handle: "bob", text: "hi", created_at: "2026-04-02T00:00:00Z" }),
    );
    expect(raw).toEqual({
      id: "9",
      text: "hi",
      created_at: "2026-04-02T00:00:00Z",
      author_id: "bob",
    });
  });
});

describe("uniqueAuthors", () => {
  it("dedupes by user_handle and falls back display→handle", () => {
    const out = uniqueAuthors([
      tweet({ user_handle: "alice", user_display: "Alice" }),
      tweet({ user_handle: "alice", user_display: "Alice 2" }),
      tweet({ user_handle: "bob", user_display: null }),
    ]);
    expect(out).toEqual([
      { id: "alice", username: "alice", name: "Alice" },
      { id: "bob", username: "bob", name: "bob" },
    ]);
  });
});

describe("searchAdapter", () => {
  function data(tweets: SearchScrapeTweet[]): SearchScrapeData {
    return {
      rawQuery: "2731787582881a",
      articleContentId: "article-content-id-zenn",
      tweets,
    };
  }

  it("throws on missing articleContentId or tweets array", () => {
    expect(() => searchAdapter({ graphqlJson: null })).toThrow(/invalid SearchScrapeData/);
    expect(() => searchAdapter({ graphqlJson: { articleContentId: 0, tweets: [] } })).toThrow(
      /invalid SearchScrapeData/,
    );
    expect(() =>
      searchAdapter({ graphqlJson: { articleContentId: "x", tweets: "not-array" } }),
    ).toThrow(/invalid SearchScrapeData/);
  });

  it("emits person + content nodes and authored + references edges per tweet", () => {
    const r = searchAdapter({
      graphqlJson: data([
        tweet({ tweet_id: "100", user_handle: "alice", text: "good post 2731787582881a" }),
      ]),
    });
    expect(r.source).toBe("x-scrape-search");
    expect(r.nodes.filter((n) => n.kind === "persons")).toHaveLength(1);
    expect(r.nodes.filter((n) => n.kind === "contents")).toHaveLength(1);
    expect(r.edges.map((e) => e.edge_type).sort()).toEqual(["authored", "references"]);
    const ref = r.edges.find((e) => e.edge_type === "references");
    expect(ref?.tgt_id).toBe("article-content-id-zenn");
    expect(ref?.src_id).toBe(deterministicId("x", "100"));
    const props = ref?.properties as { via: string; raw_query: string };
    expect(props.via).toBe("x_search_scrape");
    expect(props.raw_query).toBe("2731787582881a");
  });

  it("dedupes person seeds across multiple tweets from same user", () => {
    const r = searchAdapter({
      graphqlJson: data([
        tweet({ tweet_id: "100", user_handle: "alice" }),
        tweet({ tweet_id: "101", user_handle: "alice" }),
        tweet({ tweet_id: "102", user_handle: "bob" }),
      ]),
    });
    expect(r.nodes.filter((n) => n.kind === "persons")).toHaveLength(2);
    expect(r.nodes.filter((n) => n.kind === "contents")).toHaveLength(3);
    expect(r.edges.filter((e) => e.edge_type === "references")).toHaveLength(3);
  });

  it("skips references self-reference when scraped tweet content_id === article", () => {
    // 通常は起きないが、defensive: tweet_id をそのまま article id にぶつけたシナリオ
    const articleId = deterministicId("x", "999");
    const r = searchAdapter({
      graphqlJson: {
        rawQuery: "self",
        articleContentId: articleId,
        tweets: [tweet({ tweet_id: "999" })],
      },
    });
    expect(r.edges.filter((e) => e.edge_type === "references")).toHaveLength(0);
    // authored edge は残る
    expect(r.edges.filter((e) => e.edge_type === "authored")).toHaveLength(1);
  });

  it("emits empty result for empty tweets array", () => {
    const r = searchAdapter({ graphqlJson: data([]) });
    expect(r.nodes).toEqual([]);
    expect(r.edges).toEqual([]);
  });
});
