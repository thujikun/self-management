/**
 * 既存 contents の `metadata.referenced_tweets` から content → content edge を派生する pure helper。
 *
 * 各 content (own posts + external) は X API の `referenced_tweets` 情報を metadata に持つ。
 * これを personal_edges (replied_to / quoted / references) に展開し、graph をつなげる。
 *
 * 対応 mapping:
 * - X API `replied_to` → edge_type `replied_to`
 * - X API `quoted` → edge_type `quoted`
 * - X API `retweeted` → edge_type `references` (retweet 自体は再投稿で、本来 content 同士の参照なので references が適切)
 *
 * target tweet が parse 結果に含まれていなくても edge は作る (dangling edge)。
 * BQ は FK 強制しないので、後で hydrate して content node を埋めれば自然に解決する。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business 既存 content の referenced_tweets metadata を personal_edges に展開する pure post-processor。BQ 書き込み前に in-memory で動作。retweet は references に正規化、未取得 target も dangling edge で繋いでおく
 * @graph-connects none
 */

import { deterministicId } from "../../common/id.js";
import type { EdgeInput, NodeInput } from "../../common/types.js";

/**
 * X API の referenced_tweets.type → personal_edge_type の mapping。
 *
 * @graph-connects none
 */
export const REFERENCE_TYPE_MAP: Record<
  "replied_to" | "quoted" | "retweeted",
  "replied_to" | "quoted" | "references"
> = {
  replied_to: "replied_to",
  quoted: "quoted",
  retweeted: "references",
};

interface ReferencedTweet {
  type: "replied_to" | "quoted" | "retweeted";
  id: string;
}

/**
 * `tweet_id` から派生する deterministic content_id (own posts と同じ式)。
 *
 * @graph-connects none
 */
export function tweetIdToContentId(tweetId: string): string {
  return deterministicId("x", tweetId);
}

/**
 * 1 content の metadata から referenced_tweets を読み出す (型安全な extractor)。
 * 不正形式は無視 (catch で握り潰すのではなく、validate して落とす形)。
 *
 * @graph-connects none
 */
export function extractReferencedTweets(node: NodeInput): ReferencedTweet[] {
  const md = node.metadata as { referenced_tweets?: unknown } | null | undefined;
  const raw = md?.referenced_tweets;
  if (!Array.isArray(raw)) return [];
  const out: ReferencedTweet[] = [];
  for (const entry of raw) {
    if (
      entry &&
      typeof entry === "object" &&
      typeof (entry as { type?: unknown }).type === "string" &&
      typeof (entry as { id?: unknown }).id === "string"
    ) {
      const t = (entry as { type: string }).type;
      const id = (entry as { id: string }).id;
      if (t in REFERENCE_TYPE_MAP) {
        out.push({ type: t as ReferencedTweet["type"], id });
      }
    }
  }
  return out;
}

/**
 * contents 配列から referenced_tweets edges を生成。
 *
 * 同一 (src_content, type, target) ペアは 1 edge に dedupe (deterministicEdgeId が
 * 重複生成しても orchestrator 側で吸収されるが、ここで早期 dedupe で memory 節約)。
 *
 * @graph-connects none
 */
export function buildReferencedEdges(contents: NodeInput[]): EdgeInput[] {
  const seen = new Set<string>();
  const edges: EdgeInput[] = [];
  for (const c of contents) {
    if (c.kind !== "contents") continue;
    const refs = extractReferencedTweets(c);
    for (const r of refs) {
      const tgtId = tweetIdToContentId(r.id);
      if (tgtId === c.id) continue; // self-reference は skip
      const edgeType = REFERENCE_TYPE_MAP[r.type];
      const key = `${c.id}|${edgeType}|${tgtId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        edge_table: "personal_edges",
        edge_type: edgeType,
        src_kind: "contents",
        src_id: c.id,
        tgt_kind: "contents",
        tgt_id: tgtId,
        properties: { x_reference_type: r.type },
      });
    }
  }
  return edges;
}

/**
 * すべての referenced tweet id (= deterministic content_id) のうち、与えられた contents
 * 配列に含まれていないものを返す。hydration の入力として使う。
 *
 * @graph-connects none
 */
export function findMissingReferenceIds(contents: NodeInput[]): string[] {
  const have = new Set(
    contents.filter((c) => c.kind === "contents").map((c) => c.fields.external_id as string),
  );
  const missing = new Set<string>();
  for (const c of contents) {
    if (c.kind !== "contents") continue;
    for (const r of extractReferencedTweets(c)) {
      if (!have.has(r.id)) missing.add(r.id);
    }
  }
  return [...missing];
}
