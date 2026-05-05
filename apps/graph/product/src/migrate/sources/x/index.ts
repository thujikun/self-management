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
import { loadXCreds, type XCreds } from "./auth.js";
import type { FetchFn } from "./client.js";
import { parseAllEngagements, type EngagementType } from "./engagements.js";
import { parseAllOwnPosts } from "./posts.js";

export type LoadCredsFn = (account: string) => Promise<XCreds>;

export interface ParseXOptions {
  maxPages?: number;
  fetcher?: FetchFn;
  /** 取り込む engagement type を限定 (default: 全 4 種) */
  engagementTypes?: EngagementType[];
  /** true なら own posts のみで engagement を skip (rate limit 節約用) */
  skipEngagements?: boolean;
}

/**
 * 両アカウントの own posts + engagements を fetch して単一 ParseResult に flatten。
 *
 * @graph-connects x-api [reads_from] own posts + 4 engagement endpoint (両アカウント)
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
      });
  const all = [...ownResults, ...engagementResults];
  return {
    source: "x",
    nodes: all.flatMap((r) => r.nodes),
    edges: all.flatMap((r) => r.edges),
  };
}

export { loadXCreds } from "./auth.js";
export { X_ACCOUNTS, personIdFor } from "./accounts.js";
