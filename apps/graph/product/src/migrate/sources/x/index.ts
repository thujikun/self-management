/**
 * X parser entry。両アカウントの own posts を 1 つの ParseResult に統合して返す。
 *
 * orchestrator (`scripts/migrate.ts`) からは `parseX()` だけ叩けば動く想定。
 * loadCreds は default で `loadXCreds` (Secret Manager) だが、テストでは inject 可能。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business X 両アカウントの ingest 全体の単一 entry。両 account の own posts を 1 ParseResult に flatten して migrate.ts と同型 interface に揃える
 * @graph-connects x-api [reads_from] 両アカウントの own posts (parseAllOwnPosts 経由)
 * @graph-connects secret-manager [reads_from] xmcp-app-credentials + xmcp-user-{account} (default loadCreds)
 */

import type { ParseResult } from "../common/types.js";
import { loadXCreds, type XCreds } from "./auth.js";
import type { FetchFn } from "./client.js";
import { parseAllOwnPosts } from "./posts.js";

export type LoadCredsFn = (account: string) => Promise<XCreds>;

/**
 * 両アカウントの own posts を fetch して単一 ParseResult に flatten。
 *
 * @graph-connects x-api [reads_from] /2/users/{userId}/tweets (両アカウント)
 */
export async function parseX(
  loadCreds: LoadCredsFn = (account) => loadXCreds(account),
  opts: { maxPages?: number; fetcher?: FetchFn } = {},
): Promise<ParseResult> {
  const perAccount = await parseAllOwnPosts(loadCreds, opts);
  return {
    source: "x",
    nodes: perAccount.flatMap((r) => r.nodes),
    edges: perAccount.flatMap((r) => r.edges),
  };
}

export { loadXCreds } from "./auth.js";
export { X_ACCOUNTS, personIdFor } from "./accounts.js";
