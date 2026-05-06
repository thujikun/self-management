/**
 * scrape adapter の dispatcher。kind 文字列 → 対応 adapter を呼ぶ glue 層。
 *
 * Phase 5a 時点では全 kind が `notImplementedAdapter` (= 明示的に未実装エラー)。
 * Phase 5b 以降で順次実装に差し替える。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business kind 別 adapter table と dispatchScrape entry。CLI / future MCP
 * tool から共通入口として呼ばれ、実装の有無を一箇所で管理
 * @graph-connects none
 */

import type { ParseResult } from "../common/types.js";
import { searchAdapter } from "./search.js";
import type { ScrapeAdapter, ScrapeContext, ScrapeKind } from "./types.js";

/**
 * 未実装 adapter (Phase 5b 以降で置換)。明示的に throw して silent fallback を防ぐ。
 *
 * @graph-connects none
 */
export const notImplementedAdapter: ScrapeAdapter = ({ graphqlJson: _g, context }) => {
  void _g;
  void context;
  throw new Error(
    "ScrapeAdapter not implemented yet (Phase 5a scaffolding). Implement in Phase 5b/5c.",
  );
};

/**
 * kind → adapter の lookup table (Phase 5a 時点では全部 notImplemented)。
 *
 * @graph-connects none
 */
export const SCRAPE_ADAPTERS: Record<ScrapeKind, ScrapeAdapter> = {
  search: searchAdapter,
  retweets: notImplementedAdapter,
  quotes: notImplementedAdapter,
};

/**
 * 指定 kind の adapter を呼んで ParseResult を返す。
 * 不明 kind は早期エラー、実装済みなら委譲。
 *
 * @graph-connects none
 */
export function dispatchScrape(kind: ScrapeKind, input: ScrapeContext): ParseResult {
  const adapter = SCRAPE_ADAPTERS[kind];
  if (!adapter) {
    throw new Error(`Unknown ScrapeKind: ${String(kind)}`);
  }
  return adapter(input);
}

/**
 * test / 拡張用: SCRAPE_ADAPTERS に adapter を登録する小さな factory。
 * Phase 5b 以降で「register('search', searchAdapter)」のように差し替える形を想定。
 *
 * @graph-connects none
 */
export function registerScrapeAdapter(kind: ScrapeKind, adapter: ScrapeAdapter): void {
  SCRAPE_ADAPTERS[kind] = adapter;
}
