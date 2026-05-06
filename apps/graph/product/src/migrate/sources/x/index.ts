/**
 * X parser entry。両アカウントの own posts + 4 engagement type を 1 ParseResult に flatten。
 *
 * orchestrator (`scripts/migrate.ts`) からは `parseX()` だけ叩けば動く想定。
 * loadCreds は default で `loadXCreds` (Secret Manager) だが、テストでは inject 可能。
 *
 * 失敗時の振る舞い: own posts は throw (基幹データなので失敗させる)、engagement は
 * `parseAllEngagements` 内で per-(account, type) try/catch して空 ParseResult を返す。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business X 両アカウントの ingest 全体の単一 entry。own posts + mentions + liked + bookmark + repost を 1 ParseResult に flatten して migrate.ts と同型 interface に揃える。engagement 別失敗は分離
 * @graph-connects x-api [reads_from] own posts + 4 engagement endpoint (両アカウント)
 * @graph-connects secret-manager [reads_from] xmcp-app-credentials + xmcp-user-{account} (default loadCreds)
 */

import type { ParseResult } from "../common/types.js";
import { extractOwnTweetRefs, parseBackReferences } from "./back-references.js";
import { loadXCreds, type XCreds } from "./auth.js";
import type { FetchFn } from "./client.js";
import { parseAllEngagements, type EngagementType } from "./engagements.js";
import { parseAllOwnPosts } from "./posts.js";
import { buildReferencedEdges } from "./references.js";

export type LoadCredsFn = (account: string) => Promise<XCreds>;

export interface ParseXOptions {
  maxPages?: number;
  fetcher?: FetchFn;
  /** 取り込む engagement type を限定 (default: 全 supported 種) */
  engagementTypes?: EngagementType[];
  /** true なら own posts のみで engagement を skip (rate limit 節約用) */
  skipEngagements?: boolean;
  /** true なら referenced_tweets edges 生成を skip (default: 生成する) */
  skipReferencedEdges?: boolean;
  /** false なら back-references (retweet/quote of me) を取得 (default: true = skip)。
   *  rate limit 厳しいので opt-in。cron では maxTweets と組合せ */
  skipBackReferences?: boolean;
  /** back-references の max tweets (default: 50 = 安全な incremental サイズ) */
  backRefsMaxTweets?: number;
  /** back-references の throttle ms (default: 15000) */
  backRefsThrottleMs?: number;
  /** OAuth2 Bearer 取得を inject (test 用) */
  bearerProvider?: (account: string) => Promise<string>;
  project?: string;
}

/**
 * 両アカウントの own posts + engagements を fetch して単一 ParseResult に flatten。
 * 最後に referenced_tweets metadata から content → content edges (replied_to / quoted /
 * references) を派生させて graph を密につなげる。
 *
 * @graph-connects x-api [reads_from] own posts + engagement endpoint (両アカウント)
 */
export async function parseX(
  loadCreds: LoadCredsFn = (account) => loadXCreds(account),
  opts: ParseXOptions = {},
): Promise<ParseResult> {
  const ownResults = await parseAllOwnPosts(loadCreds, opts);
  const engagementResults = opts.skipEngagements
    ? []
    : await parseAllEngagements(loadCreds, {
        maxPages: opts.maxPages,
        fetcher: opts.fetcher,
        types: opts.engagementTypes,
        bearerProvider: opts.bearerProvider,
        project: opts.project,
      });

  // own posts ParseResult から OwnTweetRef を抽出して back-references を取得
  let backRefsResult: ParseResult | null = null;
  if (opts.skipBackReferences === false) {
    const ownNodes = ownResults.flatMap((r) => r.nodes);
    const ownTweetRefs = extractOwnTweetRefs(ownNodes);
    backRefsResult = await parseBackReferences(ownTweetRefs, {
      fetcher: opts.fetcher,
      bearerProvider: opts.bearerProvider,
      project: opts.project,
      maxTweets: opts.backRefsMaxTweets ?? 50,
      throttleMs: opts.backRefsThrottleMs,
    });
  }

  const all: ParseResult[] = [...ownResults, ...engagementResults];
  if (backRefsResult) all.push(backRefsResult);
  const allNodes = all.flatMap((r) => r.nodes);
  const baseEdges = all.flatMap((r) => r.edges);
  const referencedEdges = opts.skipReferencedEdges
    ? []
    : buildReferencedEdges(allNodes);
  return {
    source: "x",
    nodes: allNodes,
    edges: [...baseEdges, ...referencedEdges],
  };
}

export { loadXCreds } from "./auth.js";
export { X_ACCOUNTS, personIdFor } from "./accounts.js";
