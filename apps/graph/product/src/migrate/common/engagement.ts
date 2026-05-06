/**
 * `engagement_decisions` ノード + occurred_on edge + bucket cascade を組み立てる pure logic。
 *
 * scripts/x-log.ts の CLI entry はこれを呼ぶだけの薄い層。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business X / 他 platform engagement の判断ログを engagement_decisions table と time_buckets anchor に正規化する pure logic。CLI 引数 parse、決定的 ID 生成、ノード/エッジ構築を担当して BQ I/O から分離
 * @graph-connects bigquery [writes_to] engagement_decisions / time_buckets / personal_edges 用 NodeInput/EdgeInput を返却
 */

import { parseArgs } from "node:util";
import { deterministicId } from "./id.js";
import { buildBucketNodes } from "./time-buckets.js";
import type { EdgeInput, NodeInput } from "./types.js";
import {
  ENGAGEMENT_ACTION_TYPES,
  type EngagementActionType,
} from "../../schema/personal-graph/index.js";

/**
 * x-log CLI の正規化済み引数。
 *
 * @graph-connects none
 */
export interface EngagementArgs {
  action: EngagementActionType;
  platform: string;
  account: string | null;
  postedPostId: string | null;
  postedPostType: string | null;
  targetPostId: string | null;
  targetUserId: string | null;
  targetHandle: string | null;
  targetFollowers: number | null;
  ourText: string | null;
  voiceCheck: Record<string, unknown> | null;
  draftIters: number | null;
  strategyTier: string | null;
  rationale: string | null;
  decidedAt: string;
  conversationId: string | null;
  noEmbed: boolean;
  dryRun: boolean;
}

/**
 * argv 配列から EngagementArgs に parse + 必須項目検証。
 *
 * @graph-connects none
 */
export function parseEngagementArgs(argv: string[]): EngagementArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      action: { type: "string" },
      platform: { type: "string", default: "x" },
      account: { type: "string", default: "ryantsuji" },
      "posted-post-id": { type: "string" },
      "posted-post-type": { type: "string" },
      "target-post-id": { type: "string" },
      "target-user-id": { type: "string" },
      "target-handle": { type: "string" },
      "target-followers": { type: "string" },
      "our-text": { type: "string" },
      "voice-check": { type: "string" },
      "draft-iters": { type: "string" },
      "strategy-tier": { type: "string" },
      rationale: { type: "string" },
      "decided-at": { type: "string" },
      "conversation-id": { type: "string" },
      "no-embed": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
    },
    strict: true,
  });

  const action = values.action as string | undefined;
  if (!action || !(ENGAGEMENT_ACTION_TYPES as readonly string[]).includes(action)) {
    throw new Error(
      `--action は必須、許容値: ${ENGAGEMENT_ACTION_TYPES.join(" | ")}`,
    );
  }

  const decidedAt = values["decided-at"] ?? new Date().toISOString();
  if (typeof decidedAt !== "string" || isNaN(Date.parse(decidedAt))) {
    throw new Error(`--decided-at は ISO 8601 形式で指定: got ${decidedAt}`);
  }

  let voiceCheck: Record<string, unknown> | null = null;
  const vcRaw = values["voice-check"];
  if (typeof vcRaw === "string" && vcRaw.length > 0) {
    voiceCheck = JSON.parse(vcRaw) as Record<string, unknown>;
  }

  return {
    action: action as EngagementActionType,
    platform: (values.platform as string | undefined) ?? "x",
    account: (values.account as string | undefined) ?? null,
    postedPostId: (values["posted-post-id"] as string | undefined) ?? null,
    postedPostType: (values["posted-post-type"] as string | undefined) ?? null,
    targetPostId: (values["target-post-id"] as string | undefined) ?? null,
    targetUserId: (values["target-user-id"] as string | undefined) ?? null,
    targetHandle: (values["target-handle"] as string | undefined) ?? null,
    targetFollowers: values["target-followers"]
      ? parseInt(values["target-followers"] as string, 10)
      : null,
    ourText: (values["our-text"] as string | undefined) ?? null,
    voiceCheck,
    draftIters: values["draft-iters"] ? parseInt(values["draft-iters"] as string, 10) : null,
    strategyTier: (values["strategy-tier"] as string | undefined) ?? null,
    rationale: (values.rationale as string | undefined) ?? null,
    decidedAt,
    conversationId: (values["conversation-id"] as string | undefined) ?? null,
    noEmbed: Boolean(values["no-embed"]),
    dryRun: Boolean(values["dry-run"]),
  };
}

/**
 * 決定的 engagement ID。action_type + 主キー (= posted_post_id / target) で生成して
 * 同一 engagement の再 insert を MERGE で吸収。
 *
 * @graph-connects none
 */
export function buildEngagementId(args: EngagementArgs): string {
  const key = (() => {
    if (args.action === "posted" && args.postedPostId) {
      return `posted:${args.platform}:${args.postedPostId}`;
    }
    if (args.action === "follow" && args.targetUserId) {
      return `follow:${args.platform}:${args.targetUserId}`;
    }
    if (args.action === "unfollow" && args.targetUserId) {
      return `unfollow:${args.platform}:${args.targetUserId}:${args.decidedAt}`;
    }
    if (args.action === "like" && args.targetPostId) {
      return `like:${args.platform}:${args.targetPostId}`;
    }
    const target = args.targetPostId ?? args.targetUserId ?? args.targetHandle ?? "unknown";
    return `${args.action}:${args.platform}:${target}:${args.decidedAt}`;
  })();
  return deterministicId("engagement", key);
}

/**
 * EngagementArgs から engagement_decisions ノード + occurred_on edge + bucket cascade を構築。
 *
 * @graph-connects bigquery [writes_to] engagement_decisions ノード + time_buckets ノード 3 行 + occurred_on/rolls_up_to エッジ 3 本
 */
export function buildEngagementNodes(args: EngagementArgs): {
  nodes: NodeInput[];
  edges: EdgeInput[];
} {
  const engagementId = buildEngagementId(args);
  const decidedAt = new Date(args.decidedAt);
  const buckets = buildBucketNodes(decidedAt);
  const dayId = buckets.nodes[0].id;

  const summaryParts = [
    args.action,
    args.targetHandle ? `@${args.targetHandle}` : null,
    args.rationale,
    args.ourText,
  ].filter((s): s is string => typeof s === "string" && s.length > 0);

  const node: NodeInput = {
    kind: "engagement_decisions",
    id: engagementId,
    fields: {
      engagement_id: engagementId,
      platform: args.platform,
      account: args.account,
      action_type: args.action,
      posted_post_id: args.postedPostId,
      posted_post_type: args.postedPostType,
      target_post_id: args.targetPostId,
      target_user_id: args.targetUserId,
      target_handle: args.targetHandle,
      target_followers: args.targetFollowers,
      our_text: args.ourText,
      voice_check: args.voiceCheck,
      draft_iters: args.draftIters,
      strategy_tier: args.strategyTier,
      rationale: args.rationale,
      decided_at: args.decidedAt,
      conversation_id: args.conversationId,
    },
    body_summary: summaryParts.join("\n\n"),
    first_seen_at: args.decidedAt,
  };

  const occurredOn: EdgeInput = {
    edge_table: "personal_edges",
    edge_type: "occurred_on",
    src_kind: "engagement_decisions",
    src_id: engagementId,
    tgt_kind: "time_buckets",
    tgt_id: dayId,
    created_at: args.decidedAt,
  };

  return {
    nodes: [node, ...buckets.nodes],
    edges: [occurredOn, ...buckets.edges],
  };
}
