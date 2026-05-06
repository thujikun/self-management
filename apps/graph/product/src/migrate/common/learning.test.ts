/**
 * learning.ts の pure logic test。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business learnings ノード組み立て pure logic の整合性をテスト。決定的 ID 生成と time anchor cascade の一括生成、必須項目検証を担保
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";
import {
  buildLearningId,
  buildLearningNodes,
  type LearningArgs,
  parseLearningArgs,
} from "./learning.js";

const baseArgs: LearningArgs = {
  insight: "post 候補出す段階で『like で十分か reply 必要か』を triage で先に判定する",
  context: "5/4 で reply / quote draft 全部 Ryan に却下された後の振り返り",
  domain: "x-engagement",
  applicability: "engagement 候補リスト出す前の triage 段階に必ず適用",
  realizedAt: "2026-05-04T23:50:00Z",
  slug: "x-triage-like-vs-reply",
  noEmbed: true,
  dryRun: true,
};

describe("parseLearningArgs", () => {
  it("required insight + flags", () => {
    const args = parseLearningArgs([
      "--insight=foo",
      "--context=bar",
      "--domain=infra",
      "--applicability=baz",
      "--realized-at=2026-05-04T23:50:00Z",
      "--slug=foo-slug",
    ]);
    expect(args.insight).toBe("foo");
    expect(args.context).toBe("bar");
    expect(args.domain).toBe("infra");
    expect(args.applicability).toBe("baz");
  });

  it("rejects missing insight", () => {
    expect(() => parseLearningArgs([])).toThrow(/--insight は必須/);
  });

  it("rejects empty insight", () => {
    expect(() => parseLearningArgs(["--insight=  "])).toThrow(/--insight は必須/);
  });

  it("rejects invalid realized-at", () => {
    expect(() =>
      parseLearningArgs(["--insight=x", "--realized-at=bad"]),
    ).toThrow(/--realized-at は ISO 8601/);
  });

  it("default realized-at is now", () => {
    const before = Date.now();
    const args = parseLearningArgs(["--insight=x"]);
    expect(Date.parse(args.realizedAt)).toBeGreaterThanOrEqual(before);
  });

  it("flags: no-embed, dry-run", () => {
    const args = parseLearningArgs(["--insight=x", "--no-embed", "--dry-run"]);
    expect(args.noEmbed).toBe(true);
    expect(args.dryRun).toBe(true);
  });
});

describe("buildLearningId", () => {
  it("slug-based: idempotent", () => {
    const a = buildLearningId(baseArgs);
    const b = buildLearningId(baseArgs);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("different slug → different id", () => {
    const a = buildLearningId(baseArgs);
    const b = buildLearningId({ ...baseArgs, slug: "other" });
    expect(a).not.toBe(b);
  });

  it("insight fallback when no slug", () => {
    const noSlug = { ...baseArgs, slug: null };
    const a = buildLearningId(noSlug);
    const b = buildLearningId(noSlug);
    expect(a).toBe(b);
    const c = buildLearningId({ ...noSlug, insight: "different insight" });
    expect(a).not.toBe(c);
  });
});

describe("buildLearningNodes", () => {
  it("emits 1 learnings + 3 time_buckets nodes + 3 edges", () => {
    const out = buildLearningNodes(baseArgs);
    expect(out.nodes).toHaveLength(4);
    expect(out.nodes[0].kind).toBe("learnings");
    expect(out.edges).toHaveLength(3);
    expect(out.edges[0].edge_type).toBe("occurred_on");
  });

  it("learning node has correct fields", () => {
    const { nodes } = buildLearningNodes(baseArgs);
    const l = nodes[0];
    expect(l.fields.insight).toBe(baseArgs.insight);
    expect(l.fields.context).toBe(baseArgs.context);
    expect(l.fields.domain).toBe(baseArgs.domain);
    expect(l.fields.applicability).toBe(baseArgs.applicability);
    expect(l.fields.realized_at).toBe(baseArgs.realizedAt);
  });

  it("body_summary combines insight + context + applicability", () => {
    const { nodes } = buildLearningNodes(baseArgs);
    const summary = nodes[0].body_summary ?? "";
    expect(summary).toContain("triage");
    expect(summary).toContain("却下");
    expect(summary).toContain("適用");
  });

  it("occurred_on edge to day bucket", () => {
    const { edges } = buildLearningNodes(baseArgs);
    expect(edges[0]).toMatchObject({
      edge_type: "occurred_on",
      src_kind: "learnings",
      tgt_kind: "time_buckets",
      tgt_id: "day:2026-05-04",
    });
  });
});
