/**
 * 決定的 node / edge ID 生成。
 *
 * UUIDv5 (name-based) を採用。同じ source + external_id から常に同じ UUID を生成するため、
 * 同一 source の再 import で MERGE が機能する (idempotent)。
 *
 * namespace は self-management 専用に固定 (UUIDv4 を一度生成して定数化)。
 * 用途別に別 namespace は切らない (source 文字列で区別すれば衝突しない)。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business 個人グラフの全 node / edge に付与する決定的 ID 生成器。同じ入力から常に同じ UUID を返すことで再 import の MERGE 整合と分散書き込みの idempotency を担保する
 * @graph-connects none
 */

import { v5 as uuidv5 } from "uuid";

/**
 * self-management の UUIDv5 namespace。
 * RFC 4122 に従って固定。変更すると全ての ID が変わるので絶対に変えない。
 *
 * @graph-connects none
 */
const SELF_NAMESPACE = "5e9f6a3c-1d4b-4e2a-9c7f-8b0d2a5e6f1c";

/**
 * source + external_id から決定的 node ID を生成。
 *
 * @param source 由来 (例: "x", "zenn", "operations-log", "memory", "strategy-doc")
 * @param externalId source 内 native ID (例: tweet_id, slug, anchored markdown header)
 * @returns UUIDv5 string
 *
 * @graph-connects none
 */
export function deterministicId(source: string, externalId: string): string {
  return uuidv5(`${source}:${externalId}`, SELF_NAMESPACE);
}

/**
 * edge ID は (edge_type, src_kind, src_id, tgt_kind, tgt_id) から決定的に。
 * 同じ semantic edge の再生成で重複を作らない。
 *
 * @graph-connects none
 */
export function deterministicEdgeId(
  edgeType: string,
  srcKind: string,
  srcId: string,
  tgtKind: string,
  tgtId: string,
): string {
  return uuidv5(`edge:${edgeType}:${srcKind}:${srcId}:${tgtKind}:${tgtId}`, SELF_NAMESPACE);
}
