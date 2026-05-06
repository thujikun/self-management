/**
 * engagement.ts の引数 parse / ID 生成 / ノード構築 helper tests。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business engagement_decisions ノード組み立て pure logic の整合性をテスト。決定的 ID 生成 (idempotency) と bucket cascade の lazy 生成、CLI 引数 parse の必須項目検証を担保
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";
import {
  buildEngagementId,
  buildEngagementNodes,
  type EngagementArgs,
  parseEngagementArgs,
} from "./engagement.js";

const baseArgs: EngagementArgs = {
  action: "posted",
  platform: "x",
  account: "ryantsuji",
  postedPostId: "2052041746444701790",
  postedPostType: "quote",
  targetPostId: "2051659448293425342",
  targetUserId: null,
  targetHandle: "dexhorthy",
  targetFollowers: 17800,
  ourText: "this. tokens consumed ≠ KPI.",
  voiceCheck: { em_dash: 0, isnt_x_its_y: 0 },
  draftIters: 2,
  strategyTier: "reciprocation",
  rationale: "token grift cascade を framework 軸に昇華",
  decidedAt: "2026-05-06T15:04:12Z",
  conversationId: null,
  noEmbed: true,
  dryRun: true,
};

describe("parseEngagementArgs", () => {
  it("posted action with full flags", () => {
    const args = parseEngagementArgs([
      "--action=posted",
      "--platform=x",
      "--account=ryantsuji",
      "--posted-post-id=2052041746444701790",
      "--posted-post-type=quote",
      "--target-post-id=2051659448293425342",
      "--target-handle=dexhorthy",
      "--target-followers=17800",
      "--our-text=this. tokens consumed ≠ KPI.",
      "--strategy-tier=reciprocation",
      "--rationale=token grift cascade を framework 軸に昇華",
      "--decided-at=2026-05-06T15:04:12Z",
    ]);
    expect(args.action).toBe("posted");
    expect(args.platform).toBe("x");
    expect(args.postedPostId).toBe("2052041746444701790");
    expect(args.targetFollowers).toBe(17800);
    expect(args.decidedAt).toBe("2026-05-06T15:04:12Z");
    expect(args.account).toBe("ryantsuji");
  });

  it("follow action", () => {
    const args = parseEngagementArgs([
      "--action=follow",
      "--target-user-id=897875988222271488",
      "--target-handle=_PaperMoose_",
      "--target-followers=1269",
      "--strategy-tier=tier_1",
      "--rationale=CTO @heynoah, ARC-AGI 2 evals",
      "--decided-at=2026-05-06T15:15:00Z",
    ]);
    expect(args.action).toBe("follow");
    expect(args.targetUserId).toBe("897875988222271488");
    expect(args.strategyTier).toBe("tier_1");
  });

  it("voice-check parses as JSON", () => {
    const args = parseEngagementArgs([
      "--action=posted",
      "--posted-post-id=x",
      "--voice-check=" + JSON.stringify({ em_dash: 0, isnt_x_its_y: 0, praise: false }),
    ]);
    expect(args.voiceCheck).toEqual({ em_dash: 0, isnt_x_its_y: 0, praise: false });
  });

  it("draft-iters parses as int", () => {
    const args = parseEngagementArgs([
      "--action=posted",
      "--posted-post-id=x",
      "--draft-iters=3",
    ]);
    expect(args.draftIters).toBe(3);
  });

  it("rejects invalid action", () => {
    expect(() => parseEngagementArgs(["--action=invalid"])).toThrow(/--action は必須/);
  });

  it("rejects missing action", () => {
    expect(() => parseEngagementArgs([])).toThrow(/--action は必須/);
  });

  it("rejects invalid decided-at", () => {
    expect(() =>
      parseEngagementArgs(["--action=posted", "--decided-at=not-a-date"]),
    ).toThrow(/--decided-at は ISO 8601/);
  });

  it("default decided-at is now (recent timestamp)", () => {
    const before = Date.now();
    const args = parseEngagementArgs(["--action=posted", "--posted-post-id=x"]);
    const decidedAt = Date.parse(args.decidedAt);
    expect(decidedAt).toBeGreaterThanOrEqual(before);
  });

  it("no-embed and dry-run flags", () => {
    const args = parseEngagementArgs([
      "--action=posted",
      "--posted-post-id=x",
      "--no-embed",
      "--dry-run",
    ]);
    expect(args.noEmbed).toBe(true);
    expect(args.dryRun).toBe(true);
  });
});

describe("buildEngagementId", () => {
  it("posted: same posted_post_id → same id (idempotent)", () => {
    const a = buildEngagementId(baseArgs);
    const b = buildEngagementId(baseArgs);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("posted: different posted_post_id → different id", () => {
    const a = buildEngagementId({ ...baseArgs, postedPostId: "111" });
    const b = buildEngagementId({ ...baseArgs, postedPostId: "222" });
    expect(a).not.toBe(b);
  });

  it("follow: target_user_id-based (decided_at 無関係で idempotent)", () => {
    const followBase: EngagementArgs = {
      ...baseArgs,
      action: "follow",
      postedPostId: null,
      targetUserId: "1",
    };
    const a = buildEngagementId({ ...followBase, decidedAt: "2026-05-06T00:00:00Z" });
    const b = buildEngagementId({ ...followBase, decidedAt: "2026-05-07T00:00:00Z" });
    expect(a).toBe(b);
  });

  it("like: target_post_id-based", () => {
    const likeBase: EngagementArgs = {
      ...baseArgs,
      action: "like",
      postedPostId: null,
      targetPostId: "999",
    };
    const a = buildEngagementId(likeBase);
    const b = buildEngagementId({ ...likeBase, targetPostId: "888" });
    expect(a).not.toBe(b);
  });

  it("unfollow: includes decided_at (re-follow/unfollow cycle が記録できる)", () => {
    const unfollowBase: EngagementArgs = {
      ...baseArgs,
      action: "unfollow",
      postedPostId: null,
      targetUserId: "1",
    };
    const a = buildEngagementId({ ...unfollowBase, decidedAt: "2026-05-06T00:00:00Z" });
    const b = buildEngagementId({ ...unfollowBase, decidedAt: "2026-05-07T00:00:00Z" });
    expect(a).not.toBe(b);
  });

  it("dropped/skip: target + decided_at で semi-unique", () => {
    const droppedBase: EngagementArgs = {
      ...baseArgs,
      action: "dropped",
      postedPostId: null,
      targetPostId: "999",
    };
    const a = buildEngagementId({ ...droppedBase, decidedAt: "2026-05-06T00:00:00Z" });
    const b = buildEngagementId({ ...droppedBase, decidedAt: "2026-05-07T00:00:00Z" });
    expect(a).not.toBe(b);
  });
});

describe("buildEngagementNodes", () => {
  it("emits 1 engagement_decisions + 3 time_buckets nodes", () => {
    const { nodes } = buildEngagementNodes(baseArgs);
    expect(nodes).toHaveLength(4);
    expect(nodes[0].kind).toBe("engagement_decisions");
    expect(nodes.slice(1).every((n) => n.kind === "time_buckets")).toBe(true);
  });

  it("engagement node has correct fields", () => {
    const { nodes } = buildEngagementNodes(baseArgs);
    const eng = nodes[0];
    expect(eng.fields.action_type).toBe("posted");
    expect(eng.fields.posted_post_id).toBe("2052041746444701790");
    expect(eng.fields.target_handle).toBe("dexhorthy");
    expect(eng.fields.voice_check).toEqual({ em_dash: 0, isnt_x_its_y: 0 });
    expect(eng.fields.strategy_tier).toBe("reciprocation");
    expect(eng.fields.draft_iters).toBe(2);
  });

  it("body_summary contains rationale + our_text + handle + action", () => {
    const { nodes } = buildEngagementNodes(baseArgs);
    const summary = nodes[0].body_summary ?? "";
    expect(summary).toContain("@dexhorthy");
    expect(summary).toContain("token grift");
    expect(summary).toContain("posted");
  });

  it("emits occurred_on edge from engagement to day bucket + 2 rolls_up_to", () => {
    const { edges } = buildEngagementNodes(baseArgs);
    expect(edges).toHaveLength(3);
    expect(edges[0]).toMatchObject({
      edge_type: "occurred_on",
      src_kind: "engagement_decisions",
      tgt_kind: "time_buckets",
      tgt_id: "day:2026-05-06",
    });
    expect(edges[1].edge_type).toBe("rolls_up_to");
    expect(edges[2].edge_type).toBe("rolls_up_to");
  });

  it("follow action with no posted_post_id still works", () => {
    const followArgs: EngagementArgs = {
      ...baseArgs,
      action: "follow",
      postedPostId: null,
      targetPostId: null,
      targetUserId: "897875988222271488",
      targetHandle: "_PaperMoose_",
      ourText: null,
    };
    const { nodes, edges } = buildEngagementNodes(followArgs);
    expect(nodes[0].fields.action_type).toBe("follow");
    expect(nodes[0].fields.target_user_id).toBe("897875988222271488");
    expect(edges[0].edge_type).toBe("occurred_on");
  });
});
