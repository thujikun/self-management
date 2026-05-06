/**
 * chrome mcp 経由で取得した X GraphQL response → ParseResult 変換層の共通型。
 *
 * adapter は per-kind (search / retweets / quotes / ...) で実装される pure 関数。
 * 入力は chrome mcp で network panel から拾った JSON、出力は既存 ParseResult なので
 * 既存 migrate orchestrator (dedupe + embedding + mergeRows) と互換。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business chrome scraper の adapter interface 定義。X の internal GraphQL
 * response を kind 別 adapter で ParseResult に変換、API ベース ingest と同じ下流に流す
 * @graph-connects none
 */

import type { ParseResult } from "../common/types.js";

/** scraper が扱う kind (= ingest 種別)。 */
export type ScrapeKind = "search" | "retweets" | "quotes";

/** adapter の入力。chrome mcp で取った生 JSON + kind 別 context。 */
export interface ScrapeContext {
  /** chrome mcp で network 経由で取得した GraphQL response (raw object)。 */
  graphqlJson: unknown;
  /** kind 別の付随情報 (search → 元 URL、retweets/quotes → 対象 own tweet_id 等)。 */
  context?: Record<string, unknown>;
}

/**
 * 1 kind の adapter シグネチャ。chrome mcp scraper や Playwright runner から呼ばれて
 * ParseResult を返す。pure 関数のため fixture-based test 容易。
 */
export type ScrapeAdapter = (input: ScrapeContext) => ParseResult;
