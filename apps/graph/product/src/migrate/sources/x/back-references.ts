/**
 * 自分の tweet に対して外部から付けられた engagement (retweet + quote) を
 * 取り込む parser。X API v2 には "reposts of me" 単一 endpoint が無いため、
 * own tweet ごとに 2 endpoint を per-tweet iterate する。
 *
 * - **retweeted_by**: `/2/tweets/{id}/retweeted_by` → retweet したユーザ一覧 (tweet 本体 nashi)
 *   → 外部 person seed + `engaged_with(repost)` edge (person → own content)
 * - **quote_tweets**: `/2/tweets/{id}/quote_tweets` → quote tweet 一覧 (本体 + author 付き)
 *   → 外部 person + 外部 content seed + `quoted` edge (外部 content → own content) +
 *     `authored` edge (外部 person → 外部 content)
 *
 * rate limit: OAuth2 user-context で 75 req / 15min = 5 req/min。default で 4 req/min
 * (15 sec sleep) で throttle。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business 自分の tweet に対する外部 engagement (retweet/quote) を per-tweet 取り込む parser。OAuth2 必須・rate limit 厳しいので throttle + maxTweets で cron 用と backfill 用を切替
 * @graph-connects x-api [reads_from] /2/tweets/{id}/retweeted_by + /2/tweets/{id}/quote_tweets を per-tweet
 * @graph-connects bigquery [writes_to] external persons + external contents + personal_edges (engaged_with(repost) + quoted + authored)
 */

import { deterministicId } from "../../common/id.js";
import type { EdgeInput, NodeInput, ParseResult } from "../common/types.js";
import { xFetchBearer, type FetchFn } from "./client.js";
import {
  externalTweetToContentNode,
  userToPersonNode,
  type XTweetWithAuthor,
  type XUserRaw,
} from "./external-tweets.js";
import { getOAuth2Bearer } from "./oauth2.js";

/** 1 つの own tweet を指す参照 (caller = parseX が posts.ts の結果から組み立てる)。 */
export interface OwnTweetRef {
  /** X 上の tweet_id */
  tweetId: string;
  /** 我々の contents.content_id (= deterministicId("x", tweetId)) */
  ownContentId: string;
  /** OAuth2 Bearer 取得用の account ("ryantsuji" | "ryanaircloset") */
  account: string;
}

export interface ParseBackRefsOptions {
  fetcher?: FetchFn;
  /** OAuth2 Bearer 取得 (test 時は inject) */
  bearerProvider?: (account: string) => Promise<string>;
  project?: string;
  /** rate limit throttle: 各 request 後の待機 ms (default 15000 = 4 req/min) */
  throttleMs?: number;
  /** sleep 実装 (test で fake timers と組み合わせる) */
  sleep?: (ms: number) => Promise<void>;
  /** 最大 own tweets 件数 (cron 用、direct backfill では undefined = 全件) */
  maxTweets?: number;
}

/**
 * default sleep (test では sleep option を inject、本番では setTimeout)。
 *
 * @graph-connects none
 */
export function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * default bearer provider (本番は OAuth2 Secret Manager 経由、test では inject)。
 *
 * @graph-connects secret-manager [reads_from] xmcp-user-{account}-oauth2 から bearer を返す
 */
export function defaultBearerProvider(project?: string): (account: string) => Promise<string> {
  return (account) => getOAuth2Bearer(account, { project });
}

/**
 * 1 own tweet に対する retweeted_by + quote_tweets の fetch + 変換。
 *
 * @graph-connects x-api [reads_from] /2/tweets/{id}/retweeted_by + quote_tweets
 */
export async function fetchBackRefsForTweet(
  ref: OwnTweetRef,
  bearer: string,
  fetcher: FetchFn,
): Promise<{ nodes: NodeInput[]; edges: EdgeInput[] }> {
  const nodes: NodeInput[] = [];
  const edges: EdgeInput[] = [];

  // 1. retweeted_by — repost した user 一覧 (tweet 本体 nashi、user_id ベースで edge を張る)
  const rtRes = await xFetchBearer<{ data?: XUserRaw[] }>(
    bearer,
    `/2/tweets/${ref.tweetId}/retweeted_by`,
    { "user.fields": "name,username,description", max_results: "100" },
    fetcher,
  );
  for (const u of rtRes.data ?? []) {
    if (!u?.id || !u?.username) continue;
    const personNode = userToPersonNode(u);
    nodes.push(personNode);
    edges.push({
      edge_table: "personal_edges",
      edge_type: "engaged_with",
      src_kind: "persons",
      src_id: personNode.id,
      tgt_kind: "contents",
      tgt_id: ref.ownContentId,
      properties: {
        engagement: "repost",
        from: "external",
        own_account: ref.account,
      },
    });
  }

  // 2. quote_tweets — quote した tweet 本体 + 著者
  const qRes = await xFetchBearer<{
    data?: XTweetWithAuthor[];
    includes?: { users?: XUserRaw[] };
  }>(
    bearer,
    `/2/tweets/${ref.tweetId}/quote_tweets`,
    {
      max_results: "100",
      "tweet.fields": "created_at,conversation_id,referenced_tweets,in_reply_to_user_id,lang,author_id",
      expansions: "author_id",
      "user.fields": "name,username,description",
    },
    fetcher,
  );
  const authors = new Map(
    (qRes.includes?.users ?? [])
      .filter((u) => u?.id && u?.username)
      .map((u) => [u.id, u]),
  );
  for (const u of authors.values()) {
    nodes.push(userToPersonNode(u));
  }
  for (const tweet of qRes.data ?? []) {
    const { content, authorPersonId } = externalTweetToContentNode(tweet, authors, {
      back_reference: "quote_of",
      own_account: ref.account,
    });
    nodes.push(content);
    // 外部 content → own content の quoted edge
    edges.push({
      edge_table: "personal_edges",
      edge_type: "quoted",
      src_kind: "contents",
      src_id: content.id,
      tgt_kind: "contents",
      tgt_id: ref.ownContentId,
      properties: { from: "external", own_account: ref.account },
    });
    // 外部 person → 外部 content の authored edge
    if (authorPersonId) {
      edges.push({
        edge_table: "personal_edges",
        edge_type: "authored",
        src_kind: "persons",
        src_id: authorPersonId,
        tgt_kind: "contents",
        tgt_id: content.id,
        created_at: tweet.created_at,
      });
    }
  }

  return { nodes, edges };
}

/**
 * own tweet 群に対して back-references を per-tweet で fetch。throttle 付き。
 *
 * 失敗時は per-tweet で warn + skip (1 tweet の 404 が全体を止めない)。
 *
 * @graph-connects x-api [reads_from] 各 own tweet に対する 2 endpoint
 */
export async function parseBackReferences(
  ownTweets: OwnTweetRef[],
  opts: ParseBackRefsOptions = {},
): Promise<ParseResult> {
  const fetcher = opts.fetcher ?? (globalThis.fetch as unknown as FetchFn);
  const bearerProvider = opts.bearerProvider ?? defaultBearerProvider(opts.project);
  const sleep = opts.sleep ?? defaultSleep;
  const throttleMs = opts.throttleMs ?? 15_000;
  const limited = opts.maxTweets !== undefined ? ownTweets.slice(0, opts.maxTweets) : ownTweets;

  const nodes: NodeInput[] = [];
  const edges: EdgeInput[] = [];
  // account ごとに bearer を 1 回 fetch して使い回す (oauth2.ts の cache が効くが defensive)
  const bearerCache = new Map<string, string>();

  for (let i = 0; i < limited.length; i++) {
    const ref = limited[i];
    let bearer = bearerCache.get(ref.account);
    if (!bearer) {
      bearer = await bearerProvider(ref.account);
      bearerCache.set(ref.account, bearer);
    }
    try {
      const { nodes: n, edges: e } = await fetchBackRefsForTweet(ref, bearer, fetcher);
      nodes.push(...n);
      edges.push(...e);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`back-refs: tweet ${ref.tweetId} failed: ${msg}`);
    }
    // 最後の tweet は throttle 不要
    if (i < limited.length - 1) await sleep(throttleMs);
  }

  return { source: "x_back_references", nodes, edges };
}

/**
 * own posts ParseResult から OwnTweetRef[] を抽出するヘルパー。
 * `account` は metadata.account から取得 (posts.ts が tweet → contents 化する時に書く)。
 *
 * @graph-connects none
 */
export function extractOwnTweetRefs(ownPostNodes: NodeInput[]): OwnTweetRef[] {
  const out: OwnTweetRef[] = [];
  for (const n of ownPostNodes) {
    if (n.kind !== "contents") continue;
    const md = (n.metadata ?? {}) as Record<string, unknown>;
    if (md.source !== "x_post") continue;
    const tweetId = n.fields.external_id as string | undefined;
    const account = md.account as string | undefined;
    if (!tweetId) continue;
    if (!account) continue;
    out.push({
      tweetId,
      ownContentId: n.id,
      account: account === "ryantsuji" ? "ryantsuji" : "ryanaircloset",
    });
  }
  return out;
}

/**
 * `posts.ts` の content NodeInput を deterministicId で content_id に戻すヘルパー
 * (extractOwnTweetRefs の補助、test で使う)。
 *
 * @graph-connects none
 */
export function deterministicContentIdForTweet(tweetId: string): string {
  return deterministicId("x", tweetId);
}
