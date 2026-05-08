/**
 * `decisions` ノード + occurred_on edge + bucket cascade を組み立てる pure logic。
 *
 * scripts/decision-add.ts の CLI entry はこれを呼ぶだけの薄い層。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business 個別の判断ログ (decisions table) を CLI 経由で BQ に直接 insert するための pure logic。slug + decided_at で決定的 ID を生成し、time_buckets cascade と occurred_on edge を一括 emit
 * @graph-connects bigquery [writes_to] decisions / time_buckets / personal_edges 用 NodeInput/EdgeInput を返却
 */

import { parseArgs } from "node:util";
import { deterministicId } from "./id.js";
import { buildActivityAnchor } from "./time-buckets.js";
import type { EdgeInput, NodeInput } from "./types.js";

/** @graph-connects none */
export interface DecisionArgs {
  title: string;
  rationale: string | null;
  scope: Record<string, unknown> | null;
  tags: string[] | null;
  decidedAt: string;
  slug: string | null;
  noEmbed: boolean;
  dryRun: boolean;
}

/**
 * argv から DecisionArgs に parse + 必須項目検証。
 *
 * @graph-connects none
 */
export function parseDecisionArgs(argv: string[]): DecisionArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      title: { type: "string" },
      rationale: { type: "string" },
      scope: { type: "string" },
      tags: { type: "string" },
      "decided-at": { type: "string" },
      slug: { type: "string" },
      "no-embed": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
    },
    strict: true,
  });

  const title = values.title as string | undefined;
  if (!title || title.trim().length === 0) {
    throw new Error("--title は必須");
  }

  const decidedAt = values["decided-at"] ?? new Date().toISOString();
  if (typeof decidedAt !== "string" || isNaN(Date.parse(decidedAt))) {
    throw new Error(`--decided-at は ISO 8601: got ${decidedAt}`);
  }

  let scope: Record<string, unknown> | null = null;
  const sRaw = values.scope;
  if (typeof sRaw === "string" && sRaw.length > 0) {
    scope = JSON.parse(sRaw) as Record<string, unknown>;
  }

  const tagsRaw = values.tags;
  const tags =
    typeof tagsRaw === "string" && tagsRaw.length > 0
      ? tagsRaw
          .split(",")
          .map((t) => t.trim())
          .filter((t) => t.length > 0)
      : null;

  return {
    title: title.trim(),
    rationale: (values.rationale as string | undefined) ?? null,
    scope,
    tags,
    decidedAt,
    slug: (values.slug as string | undefined) ?? null,
    noEmbed: Boolean(values["no-embed"]),
    dryRun: Boolean(values["dry-run"]),
  };
}

/**
 * 決定的 decision ID。明示 slug があればそれを、無ければ title + decided_at(date) ベース。
 *
 * @graph-connects none
 */
export function buildDecisionId(args: DecisionArgs): string {
  const day = args.decidedAt.slice(0, 10);
  const key = args.slug ? `${day}:${args.slug}` : `${day}:${args.title}`;
  return deterministicId("decision", key);
}

/**
 * DecisionArgs から decisions ノード + bucket cascade + occurred_on edge を構築。
 *
 * @graph-connects bigquery [writes_to] decisions ノード + time_buckets ノード 3 + edges 3 (occurred_on + 2 rolls_up_to)
 */
export function buildDecisionNodes(args: DecisionArgs): {
  nodes: NodeInput[];
  edges: EdgeInput[];
} {
  const id = buildDecisionId(args);
  const date = new Date(args.decidedAt);
  const anchor = buildActivityAnchor("decisions", id, date);

  const summaryParts = [args.title, args.rationale].filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );

  const node: NodeInput = {
    kind: "decisions",
    id,
    fields: {
      decision_id: id,
      title: args.title,
      rationale_md: args.rationale,
      decided_at: args.decidedAt,
      scope: args.scope,
    },
    body_summary: summaryParts.join("\n\n"),
    metadata: args.tags ? { tags: args.tags } : null,
    first_seen_at: args.decidedAt,
  };

  return {
    nodes: [node, ...anchor.nodes],
    edges: anchor.edges,
  };
}
