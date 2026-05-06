/**
 * `learnings` ノード + occurred_on edge + bucket cascade を組み立てる pure logic。
 *
 * decisions が「個別判断」を記録するのに対し、learnings は「将来も再利用可能な原則 /
 * 適用ルール」を捉える。同じ insight を複数 session で再発見しないように durable に置く。
 *
 * scripts/learning-add.ts の CLI entry はこれを呼ぶだけの薄い層。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business cross-session insight (learnings table) を CLI 経由で BQ に直接 insert するための pure logic。insight + realized_at で決定的 ID を生成し、time_buckets cascade と occurred_on edge を一括 emit
 * @graph-connects bigquery [writes_to] learnings / time_buckets / personal_edges 用 NodeInput/EdgeInput を返却
 */

import { parseArgs } from "node:util";
import { deterministicId } from "./id.js";
import { buildActivityAnchor } from "./time-buckets.js";
import type { EdgeInput, NodeInput } from "./types.js";

/** @graph-connects none */
export interface LearningArgs {
  insight: string;
  context: string | null;
  domain: string | null;
  applicability: string | null;
  realizedAt: string;
  slug: string | null;
  noEmbed: boolean;
  dryRun: boolean;
}

/**
 * argv から LearningArgs に parse + 必須項目検証。
 *
 * @graph-connects none
 */
export function parseLearningArgs(argv: string[]): LearningArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      insight: { type: "string" },
      context: { type: "string" },
      domain: { type: "string" },
      applicability: { type: "string" },
      "realized-at": { type: "string" },
      slug: { type: "string" },
      "no-embed": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
    },
    strict: true,
  });

  const insight = values.insight as string | undefined;
  if (!insight || insight.trim().length === 0) {
    throw new Error("--insight は必須");
  }

  const realizedAt = values["realized-at"] ?? new Date().toISOString();
  if (typeof realizedAt !== "string" || isNaN(Date.parse(realizedAt))) {
    throw new Error(`--realized-at は ISO 8601: got ${realizedAt}`);
  }

  return {
    insight: insight.trim(),
    context: (values.context as string | undefined) ?? null,
    domain: (values.domain as string | undefined) ?? null,
    applicability: (values.applicability as string | undefined) ?? null,
    realizedAt,
    slug: (values.slug as string | undefined) ?? null,
    noEmbed: Boolean(values["no-embed"]),
    dryRun: Boolean(values["dry-run"]),
  };
}

/**
 * 決定的 learning ID。明示 slug があればそれを、無ければ insight + realized_at(date) ベース。
 *
 * @graph-connects none
 */
export function buildLearningId(args: LearningArgs): string {
  const day = args.realizedAt.slice(0, 10);
  const key = args.slug ? `${day}:${args.slug}` : `${day}:${args.insight}`;
  return deterministicId("learning", key);
}

/**
 * LearningArgs から learnings ノード + bucket cascade + occurred_on edge を構築。
 *
 * @graph-connects bigquery [writes_to] learnings ノード + time_buckets ノード 3 + edges 3
 */
export function buildLearningNodes(args: LearningArgs): {
  nodes: NodeInput[];
  edges: EdgeInput[];
} {
  const id = buildLearningId(args);
  const date = new Date(args.realizedAt);
  const anchor = buildActivityAnchor("learnings", id, date);

  const summaryParts = [args.insight, args.context, args.applicability].filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );

  const node: NodeInput = {
    kind: "learnings",
    id,
    fields: {
      learning_id: id,
      insight: args.insight,
      context: args.context,
      domain: args.domain,
      applicability: args.applicability,
      realized_at: args.realizedAt,
    },
    body_summary: summaryParts.join("\n\n"),
    first_seen_at: args.realizedAt,
  };

  return {
    nodes: [node, ...anchor.nodes],
    edges: anchor.edges,
  };
}
