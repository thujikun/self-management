/**
 * 自分の X own posts を contents node + authored edges に変換する parser。
 *
 * - `/2/users/{userId}/tweets` を cursor pagination で全 page なめる
 * - 各 tweet を 1 つの contents node (kind=contents, source=x) に
 * - 著者 person を seed して authored edge (persons → contents) を張る
 * - `referenced_tweets` から subtype (tweet / reply / retweet / quote) を導出
 * - replied_to / quoted の **edge** はここでは作らない (Phase 4c で別 parser)
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business 両 X account の own posts を contents table に backfill する parser。各 tweet を 1 contents node にし、authored edge で著者 person と接続。subtype は referenced_tweets から導出
 * @graph-connects x-api [reads_from] /2/users/{userId}/tweets を cursor pagination
 * @graph-connects bigquery [writes_to] contents + persons + personal_edges に投入される ParseResult を生成
 */

import { deterministicId } from "../../common/id.js";
import type { EdgeInput, NodeInput, ParseResult } from "../common/types.js";
import { X_ACCOUNTS, personIdFor, type XAccountConfig } from "./accounts.js";
import type { XCreds } from "./auth.js";
import { xPaginate, type FetchFn } from "./client.js";

/** @graph-connects none */
export const POSTS_SOURCE = "x_post";

/** X v2 tweet object の subset (parser が読む field のみ)。 */
export interface XTweetRaw {
  id: string;
  text: string;
  created_at?: string;
  conversation_id?: string;
  referenced_tweets?: Array<{
    type: "replied_to" | "quoted" | "retweeted";
    id: string;
  }>;
  in_reply_to_user_id?: string;
  lang?: string;
}

export type TweetSubtype = "tweet" | "reply" | "retweet" | "quote";

/**
 * `referenced_tweets` から subtype を判定。優先順位は retweet > quote > reply > tweet。
 * (1 つの tweet が複数 referenced_tweets を持つことは稀だが、X 仕様では発生しうる。)
 *
 * @graph-connects none
 */
export function tweetSubtype(t: XTweetRaw): TweetSubtype {
  const refs = t.referenced_tweets ?? [];
  if (refs.some((r) => r.type === "retweeted")) return "retweet";
  if (refs.some((r) => r.type === "quoted")) return "quote";
  if (refs.some((r) => r.type === "replied_to")) return "reply";
  return "tweet";
}

/**
 * 1 tweet を 1 contents node に。`text` を body と summary 両方に使う (X 投稿は短いので
 * separate な要約を持たない; embedding 入力としても tweet 全文がベスト)。
 *
 * @graph-connects none
 */
export function tweetToContentNode(
  tweet: XTweetRaw,
  account: XAccountConfig,
  personId: string,
): NodeInput {
  const id = deterministicId("x", tweet.id);
  const url = `https://x.com/${account.handle}/status/${tweet.id}`;
  const subtype = tweetSubtype(tweet);
  const titleRaw = tweet.text.replace(/\s+/g, " ").trim();
  return {
    kind: "contents",
    id,
    fields: {
      content_id: id,
      source: "x",
      external_id: tweet.id,
      url,
      title: titleRaw.slice(0, 80),
      body_md: tweet.text,
      published_at: tweet.created_at ?? null,
      author_person_id: personId,
    },
    body_summary: tweet.text,
    metadata: {
      source: POSTS_SOURCE,
      account: account.handle,
      subtype,
      conversation_id: tweet.conversation_id ?? null,
      referenced_tweets: tweet.referenced_tweets ?? [],
      in_reply_to_user_id: tweet.in_reply_to_user_id ?? null,
      language: tweet.lang ?? account.language,
    },
    first_seen_at: tweet.created_at,
  };
}

/**
 * 著者 person を seed する NodeInput を返す。orchestrator が dedupe する前提で
 * 各 source parser から呼んで OK (id が同じなら最後勝ち)。
 *
 * @graph-connects none
 */
export function personSeedNode(account: XAccountConfig, personId: string): NodeInput {
  return {
    kind: "persons",
    id: personId,
    fields: {
      person_id: personId,
      primary_handle: account.handle,
      identifiers: [
        { platform: "x", value: account.handle },
        { platform: "x_id", value: account.userId },
      ],
      display_name: account.displayName,
      bio: account.bio,
    },
    body_summary: account.bio,
    metadata: { language: account.language, role: "self" },
  };
}

/**
 * own posts を 1 アカウント分 fetch して ParseResult を返す。
 *
 * @param account X_ACCOUNTS の 1 entry
 * @param creds 同 account の OAuth credentials
 * @param opts maxPages / fetcher を inject 可能
 *
 * @graph-connects x-api [reads_from] /2/users/{userId}/tweets を全 page fetch
 */
export async function parseOwnPosts(
  account: XAccountConfig,
  creds: XCreds,
  opts: { maxPages?: number; fetcher?: FetchFn } = {},
): Promise<ParseResult> {
  const personId = personIdFor(account);
  const nodes: NodeInput[] = [personSeedNode(account, personId)];
  const edges: EdgeInput[] = [];

  const path = `/2/users/${account.userId}/tweets`;
  const query: Record<string, string> = {
    max_results: "100",
    "tweet.fields":
      "created_at,conversation_id,referenced_tweets,in_reply_to_user_id,lang",
    exclude: "", // 何も除外しない (replies/retweets 含む全部)
  };
  // exclude="" だと X 側で 422 になることがあるので key 自体を除く
  delete query.exclude;

  for (const page of await xPaginate<XTweetRaw>(creds, path, query, opts)) {
    for (const tweet of page.data) {
      const node = tweetToContentNode(tweet, account, personId);
      nodes.push(node);
      edges.push({
        edge_table: "personal_edges",
        edge_type: "authored",
        src_kind: "persons",
        src_id: personId,
        tgt_kind: "contents",
        tgt_id: node.id,
        created_at: tweet.created_at,
      });
    }
  }

  return { source: `${POSTS_SOURCE}:${account.account}`, nodes, edges };
}

/**
 * 両アカウントの own posts を一括 fetch (auth は loadXCreds に呼び出し側で任せる)。
 *
 * @graph-connects x-api [reads_from] 両アカウントの /2/users/{userId}/tweets
 */
export async function parseAllOwnPosts(
  loadCreds: (account: string) => Promise<XCreds>,
  opts: { maxPages?: number; fetcher?: FetchFn } = {},
): Promise<ParseResult[]> {
  const out: ParseResult[] = [];
  for (const account of X_ACCOUNTS) {
    const creds = await loadCreds(account.account);
    out.push(await parseOwnPosts(account, creds, opts));
  }
  return out;
}
