/**
 * 外部 tweet を取り込む engagement parser。
 *
 * サポート type:
 * - **mention** (OAuth1): 自分が @mention された tweet → mentioned_in edge
 * - **like** (OAuth1): 自分が like した tweet → engaged_with(like) edge
 * - **bookmark** (OAuth2): 自分が bookmark した private リスト → engaged_with(bookmark) edge
 *
 * bookmark は X API 仕様上 OAuth 2.0 User Context 必須 (OAuth1 では 403) なので
 * `oauth2.ts` 経由で Bearer を取得して xPaginateBearer で叩く分岐を持つ。
 *
 * 未サポート: repost-of-me / quote-of-me (back-references.ts で per-tweet iterate)。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business 外部 tweet 系 endpoint (mention / like / bookmark) を共通化した engagement parser。各 type の path / edge_type / engagement 種別 + 認証方式 (OAuth1/OAuth2) を table 駆動で切替。author seed は external-tweets.ts に委譲
 * @graph-connects x-api [reads_from] /2/users/:id/{mentions, liked_tweets, bookmarks}
 * @graph-connects bigquery [writes_to] contents (外部 tweet) + persons (外部 author seed) + personal_edges (engaged_with / mentioned_in)
 */

import type { EdgeInput, NodeInput, ParseResult } from "../../common/types.js";
import { personIdFor, X_ACCOUNTS, type XAccountConfig } from "./accounts.js";
import type { XCreds } from "./auth.js";
import { xPaginate, xPaginateBearer, type FetchFn } from "./client.js";
import { externalTweetsToNodes, type XTweetWithAuthor, type XUserRaw } from "./external-tweets.js";
import { getOAuth2Bearer } from "./oauth2.js";

export type EngagementType = "mention" | "like" | "bookmark";

export type EngagementAuth = "oauth1" | "oauth2";

interface EngagementConfig {
  /** path builder (account.userId を受けて X API path を返す) */
  path: (userId: string) => string;
  /** Ryan -> content の edge type */
  edgeType: "mentioned_in" | "engaged_with";
  /** edge.properties.engagement に入れる種別文字列 */
  engagement: string;
  /** 認証方式 (OAuth1 = 既存 user creds、OAuth2 = bookmark 等で必須) */
  auth: EngagementAuth;
}

/** @graph-connects none */
export const ENGAGEMENT_CONFIGS: Record<EngagementType, EngagementConfig> = {
  mention: {
    path: (uid) => `/2/users/${uid}/mentions`,
    edgeType: "mentioned_in",
    engagement: "mention",
    auth: "oauth1",
  },
  like: {
    path: (uid) => `/2/users/${uid}/liked_tweets`,
    edgeType: "engaged_with",
    engagement: "like",
    auth: "oauth1",
  },
  bookmark: {
    path: (uid) => `/2/users/${uid}/bookmarks`,
    edgeType: "engaged_with",
    engagement: "bookmark",
    auth: "oauth2",
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
 * 認証は config.auth が "oauth1" なら既存 OAuth1 creds、"oauth2" なら getOAuth2Bearer
 * で取得した Bearer を使う。bookmark は OAuth2 必須。
 *
 * @graph-connects x-api [reads_from] 該当 endpoint を cursor pagination
 * @graph-connects secret-manager [reads_from] OAuth2 type の場合 xmcp-user-{account}-oauth2 から Bearer 取得
 */
export interface ParseEngagementsOptions {
  maxPages?: number;
  fetcher?: FetchFn;
  /** OAuth2 用: Bearer 取得を inject (test 時に SM を回避) */
  bearerProvider?: (account: string) => Promise<string>;
  project?: string;
  /** mention 用 since_id (それ以外の type では無視) */
  sinceId?: string;
}

/**
 * 1 アカウント × 1 engagement type 分の ingest。
 *
 * @graph-connects x-api [reads_from] /2/users/:id/{mentions, liked_tweets, bookmarks} を fetch
 */
export async function parseEngagements(
  account: XAccountConfig,
  creds: XCreds,
  type: EngagementType,
  opts: ParseEngagementsOptions = {},
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
  // since_id は X API v2 でも mention のみサポート (liked / bookmark は非対応)
  if (opts.sinceId && type === "mention") query.since_id = opts.sinceId;

  const pages =
    config.auth === "oauth2"
      ? await xPaginateBearer<XTweetWithAuthor>(
          await (opts.bearerProvider ?? ((a) => getOAuth2Bearer(a, { project: opts.project })))(
            account.account,
          ),
          path,
          query,
          opts,
        )
      : await xPaginate<XTweetWithAuthor>(creds, path, query, opts);

  for (const page of pages) {
    const authors = ((page.includes?.users as XUserRaw[] | undefined) ?? []).filter(
      (u): u is XUserRaw => Boolean(u && u.id && u.username),
    );
    const { contentNodes, personNodes } = externalTweetsToNodes(page.data, authors, {
      engagement: config.engagement,
      ingested_for: account.account,
    });
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
export interface ParseAllEngagementsOptions {
  maxPages?: number;
  fetcher?: FetchFn;
  types?: EngagementType[];
  bearerProvider?: (account: string) => Promise<string>;
  project?: string;
  /** account ごとの mention since_id provider。null なら全件 (初回 ingest) */
  mentionSinceIdProvider?: (account: string) => Promise<string | null>;
  /** liked / bookmark 用の maxPages override (since_id 非対応なので件数で抑える) */
  noSinceIdMaxPages?: number;
}

/**
 * 全アカウント × 全 engagement type を順次 fetch して ParseResult[] を返す。
 *
 * @graph-connects x-api [reads_from] 全アカウント × engagement endpoint
 */
export async function parseAllEngagements(
  loadCreds: (account: string) => Promise<XCreds>,
  opts: ParseAllEngagementsOptions = {},
): Promise<ParseResult[]> {
  const types: EngagementType[] = opts.types ?? ["mention", "like", "bookmark"];
  const out: ParseResult[] = [];
  for (const account of X_ACCOUNTS) {
    const creds = await loadCreds(account.account);
    for (const type of types) {
      const perCallOpts: ParseEngagementsOptions = { ...opts };
      if (type === "mention" && opts.mentionSinceIdProvider) {
        perCallOpts.sinceId = (await opts.mentionSinceIdProvider(account.account)) ?? undefined;
      }
      // liked / bookmark は since_id 非対応なので maxPages で件数を抑える
      if ((type === "like" || type === "bookmark") && opts.noSinceIdMaxPages !== undefined) {
        perCallOpts.maxPages = opts.noSinceIdMaxPages;
      }
      try {
        const r = await parseEngagements(account, creds, type, perCallOpts);
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
