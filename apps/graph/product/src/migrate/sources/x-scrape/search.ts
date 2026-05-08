/**
 * `search` kind の scrape adapter。chrome mcp で X 検索ページの DOM から
 * 抜いた tweet 配列を ParseResult に変換する pure 関数。
 *
 * Phase 5b の本命: 「他人が私の記事 URL を share した tweet」を `references` edge
 * (scraped tweet → article content) として検出する。API back-references の
 * 補完で、credits を使わずブラウザ経由で取得できる。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business X 検索 DOM scrape を ParseResult に変換。外部 person seed +
 * 外部 content (= 検索 hit tweet) + authored edge + references edge (tweet →
 * 検索対象 article) を生成。既存 externalTweetsToNodes helper を流用
 * @graph-connects none
 */

import type { EdgeInput } from "../../common/types.js";
import {
  externalTweetsToNodes,
  type XTweetWithAuthor,
  type XUserRaw,
} from "../x/external-tweets.js";
import type { ScrapeAdapter, SearchScrapeData, SearchScrapeTweet } from "./types.js";

/**
 * `SearchScrapeTweet` を既存 `XTweetWithAuthor` 形式 (X v2 API tweet 互換) に
 * 変換する helper。author_id は `user_handle` を流用 (DOM 由来で X 数値 user_id
 * は取れないため、handle ベースの person dedupe にする)。
 *
 * @graph-connects none
 */
export function tweetToRaw(t: SearchScrapeTweet): XTweetWithAuthor {
  return {
    id: t.tweet_id,
    text: t.text,
    created_at: t.created_at,
    author_id: t.user_handle,
  };
}

/**
 * `SearchScrapeTweet` 配列から重複除去された XUserRaw 配列を作る (handle 基準)。
 *
 * @graph-connects none
 */
export function uniqueAuthors(tweets: SearchScrapeTweet[]): XUserRaw[] {
  const map = new Map<string, XUserRaw>();
  for (const t of tweets) {
    if (map.has(t.user_handle)) continue;
    map.set(t.user_handle, {
      id: t.user_handle,
      username: t.user_handle,
      name: t.user_display ?? t.user_handle,
    });
  }
  return [...map.values()];
}

/**
 * `search` kind adapter。input.graphqlJson に SearchScrapeData を渡す。
 *
 * @graph-connects none
 */
export const searchAdapter: ScrapeAdapter = (input) => {
  const data = input.graphqlJson as SearchScrapeData;
  if (!data || typeof data.articleContentId !== "string" || !Array.isArray(data.tweets)) {
    throw new Error("searchAdapter: invalid SearchScrapeData (missing articleContentId / tweets)");
  }
  const rawTweets = data.tweets.map(tweetToRaw);
  const authors = uniqueAuthors(data.tweets);
  const { contentNodes, personNodes, contentToAuthor } = externalTweetsToNodes(rawTweets, authors, {
    source: "x_search_scrape",
    raw_query: data.rawQuery,
  });
  const edges: EdgeInput[] = [];
  for (const c of contentNodes) {
    const authorId = contentToAuthor.get(c.id);
    if (authorId) {
      edges.push({
        edge_table: "personal_edges",
        edge_type: "authored",
        src_kind: "persons",
        src_id: authorId,
        tgt_kind: "contents",
        tgt_id: c.id,
      });
    }
    if (c.id !== data.articleContentId) {
      edges.push({
        edge_table: "personal_edges",
        edge_type: "references",
        src_kind: "contents",
        src_id: c.id,
        tgt_kind: "contents",
        tgt_id: data.articleContentId,
        properties: { via: "x_search_scrape", raw_query: data.rawQuery },
      });
    }
  }
  return {
    source: "x-scrape-search",
    nodes: [...personNodes, ...contentNodes],
    edges,
  };
};
