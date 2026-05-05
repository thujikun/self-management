/**
 * 外部 tweet を取り込む engagement parser。
 *
 * 現状サポート:
 * - **mentions**: 自分が @mention された tweet (`/2/users/:id/mentions`) → mentioned_in edge
 * - **liked**: 自分が like した tweet (`/2/users/:id/liked_tweets`) → engaged_with(like) edge
 *
 * 未サポート (TODO):
 * - **bookmark**: `/2/users/:id/bookmarks` は OAuth 2.0 User Context 必須、現状の OAuth 1.0a
 *   credentials では 403。OAuth2 flow を xmcp に追加してから対応 (別 phase)
 * - **repost**: X API v2 には "reposts of me" 単一 endpoint 無し (v1.1 のみ)。v2 では
 *   `/2/tweets/:id/retweeted_by` を own posts ごとに iterate する必要あり、edge 拡充の
 *   Phase 4c で対応
 *
 * 各 parser は同じ pagination + author seed + content/edge 生成パターンを共有するため、
 * `parseEngagements(account, creds, type)` で type 切替する設計。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business 外部 tweet 系 endpoint (mentions/liked) を共通化した engagement parser。各 type の path / edge_type / engagement 種別だけ table 駆動で切替。author seed は external-tweets.ts に委譲。bookmark/repost は API 制約で別 phase
 * @graph-connects x-api [reads_from] /2/users/:id/{mentions, liked_tweets}
 * @graph-connects bigquery [writes_to] contents (外部 tweet) + persons (外部 author seed) + personal_edges (engaged_with / mentioned_in)
 */

import type { EdgeInput, NodeInput, ParseResult } from "../common/types.js";
import { personIdFor, X_ACCOUNTS, type XAccountConfig } from "./accounts.js";
import type { XCreds } from "./auth.js";
import { xPaginate, type FetchFn } from "./client.js";
import {
  externalTweetsToNodes,
  type XTweetWithAuthor,
  type XUserRaw,
} from "./external-tweets.js";

export type EngagementType = "mention" | "like";

interface EngagementConfig {
  /** path builder (account.userId を受けて X API path を返す) */
  path: (userId: string) => string;
  /** Ryan -> content の edge type */
  edgeType: "mentioned_in" | "engaged_with";
  /** edge.properties.engagement に入れる種別文字列 */
  engagement: string;
}

/** @graph-connects none */
export const ENGAGEMENT_CONFIGS: Record<EngagementType, EngagementConfig> = {
  mention: {
    path: (uid) => `/2/users/${uid}/mentions`,
    edgeType: "mentioned_in",
    engagement: "mention",
  },
  like: {
    path: (uid) => `/2/users/${uid}/liked_tweets`,
    edgeType: "engaged_with",
    engagement: "like",
  },
};

/** @graph-connects none */
const TWEET_FIELDS =
  "created_at,conversation_id,referenced_tweets,in_reply_to_user_id,lang,author_id";
/** @graph-connects none */
const USER_FIELDS = "name,username,description";

/**
 * 1 アカウント × 1 engagement type 分の ingest。
 *
 * @graph-connects x-api [reads_from] 該当 endpoint を cursor pagination
 */
export async function parseEngagements(
  account: XAccountConfig,
  creds: XCreds,
  type: EngagementType,
  opts: { maxPages?: number; fetcher?: FetchFn } = {},
): Promise<ParseResult> {
  const config = ENGAGEMENT_CONFIGS[type];
  const personId = personIdFor(account);
  const nodes: NodeInput[] = [];
  const edges: EdgeInput[] = [];

  const path = config.path(account.userId);
  const query: Record<string, string> = {
    max_results: "100",
    "tweet.fields": TWEET_FIELDS,
    expansions: "author_id",
    "user.fields": USER_FIELDS,
  };

  for await (const page of xPaginate<XTweetWithAuthor>(creds, path, query, opts)) {
    const authors = ((page.includes?.users as XUserRaw[] | undefined) ?? []).filter(
      (u): u is XUserRaw => Boolean(u && u.id && u.username),
    );
    const { contentNodes, personNodes } = externalTweetsToNodes(
      page.data,
      authors,
      { engagement: config.engagement, ingested_for: account.account },
    );
    nodes.push(...contentNodes, ...personNodes);
    for (const c of contentNodes) {
      edges.push({
        edge_table: "personal_edges",
        edge_type: config.edgeType,
        src_kind: "persons",
        src_id: personId,
        tgt_kind: "contents",
        tgt_id: c.id,
        properties: { engagement: config.engagement, account: account.account },
      });
    }
  }

  return { source: `x_${type}:${account.account}`, nodes, edges };
}

/**
 * 全アカウント × 全 engagement type を fetch して ParseResult[] を返す。
 *
 * 1 つの type が 1 アカウントで失敗しても他に影響させないため、各 (account, type) 組合せを
 * try/catch で包む。失敗時は console.warn で notice、空 ParseResult を返す。
 *
 * @graph-connects x-api [reads_from] 全アカウント × 4 engagement endpoint
 */
export async function parseAllEngagements(
  loadCreds: (account: string) => Promise<XCreds>,
  opts: { maxPages?: number; fetcher?: FetchFn; types?: EngagementType[] } = {},
): Promise<ParseResult[]> {
  const types: EngagementType[] = opts.types ?? ["mention", "like"];
  const out: ParseResult[] = [];
  for (const account of X_ACCOUNTS) {
    const creds = await loadCreds(account.account);
    for (const type of types) {
      try {
        const r = await parseEngagements(account, creds, type, opts);
        out.push(r);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`x-engagements: ${account.account}/${type} failed: ${msg}`);
        out.push({ source: `x_${type}:${account.account}`, nodes: [], edges: [] });
      }
    }
  }
  return out;
}
