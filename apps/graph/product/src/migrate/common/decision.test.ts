/**
 * decision.ts の pure logic test。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business decisions ノード組み立て pure logic の整合性をテスト。決定的 ID 生成 (slug-based / title fallback) と time anchor cascade の一括生成を担保
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";
import {
  buildDecisionId,
  buildDecisionNodes,
  type DecisionArgs,
  parseDecisionArgs,
} from "./decision.js";

const baseArgs: DecisionArgs = {
  title: "X activity を BQ structured table に移す",
  rationale: "md hypertrophy 防止、構造化 record で graph search 可能化",
  scope: { area: "x-engagement-logging" },
  tags: ["infra", "logging"],
  decidedAt: "2026-05-06T16:00:00Z",
  slug: "x-activity-bq-migration",
  noEmbed: true,
  dryRun: true,
};

describe("parseDecisionArgs", () => {
  it("required title + flags", () => {
    const args = parseDecisionArgs([
      "--title=foo",
      "--rationale=bar",
      "--scope=" + JSON.stringify({ area: "x" }),
      "--tags=a,b,c",
      "--decided-at=2026-05-06T15:00:00Z",
      "--slug=foo-slug",
    ]);
    expect(args.title).toBe("foo");
    expect(args.rationale).toBe("bar");
    expect(args.scope).toEqual({ area: "x" });
    expect(args.tags).toEqual(["a", "b", "c"]);
    expect(args.slug).toBe("foo-slug");
  });

  it("rejects missing title", () => {
    expect(() => parseDecisionArgs([])).toThrow(/--title は必須/);
  });

  it("rejects empty title", () => {
    expect(() => parseDecisionArgs(["--title=  "])).toThrow(/--title は必須/);
  });

  it("rejects invalid decided-at", () => {
    expect(() => parseDecisionArgs(["--title=x", "--decided-at=not-a-date"])).toThrow(
      /--decided-at は ISO 8601/,
    );
  });

  it("default decided-at is now", () => {
    const before = Date.now();
    const args = parseDecisionArgs(["--title=x"]);
    expect(Date.parse(args.decidedAt)).toBeGreaterThanOrEqual(before);
  });

  it("tags=空文字列なら null", () => {
    const args = parseDecisionArgs(["--title=x", "--tags="]);
    expect(args.tags).toBeNull();
  });

  it("flags: no-embed, dry-run", () => {
    const args = parseDecisionArgs(["--title=x", "--no-embed", "--dry-run"]);
    expect(args.noEmbed).toBe(true);
    expect(args.dryRun).toBe(true);
  });
});

describe("buildDecisionId", () => {
  it("slug-based: same slug + date → same id", () => {
    const a = buildDecisionId(baseArgs);
    const b = buildDecisionId(baseArgs);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("different slug → different id", () => {
    const a = buildDecisionId(baseArgs);
    const b = buildDecisionId({ ...baseArgs, slug: "other" });
    expect(a).not.toBe(b);
  });

  it("title fallback when no slug", () => {
    const noSlug = { ...baseArgs, slug: null };
    const a = buildDecisionId(noSlug);
    const b = buildDecisionId(noSlug);
    expect(a).toBe(b);
    const c = buildDecisionId({ ...noSlug, title: "different title" });
    expect(a).not.toBe(c);
  });

  it("same slug different date → different id", () => {
    const a = buildDecisionId(baseArgs);
    const b = buildDecisionId({ ...baseArgs, decidedAt: "2026-05-07T16:00:00Z" });
    expect(a).not.toBe(b);
  });
});

describe("buildDecisionNodes", () => {
  it("emits 1 decisions + 3 time_buckets nodes + 3 edges", () => {
    const out = buildDecisionNodes(baseArgs);
    expect(out.nodes).toHaveLength(4);
    expect(out.nodes[0].kind).toBe("decisions");
    expect(out.edges).toHaveLength(3);
    expect(out.edges[0].edge_type).toBe("occurred_on");
  });

  it("decision node has correct fields", () => {
    const { nodes } = buildDecisionNodes(baseArgs);
    const d = nodes[0];
    expect(d.fields.title).toBe(baseArgs.title);
    expect(d.fields.rationale_md).toBe(baseArgs.rationale);
    expect(d.fields.decided_at).toBe(baseArgs.decidedAt);
    expect(d.fields.scope).toEqual(baseArgs.scope);
    expect(d.metadata).toEqual({ tags: baseArgs.tags });
  });

  it("body_summary contains title + rationale", () => {
    const { nodes } = buildDecisionNodes(baseArgs);
    expect(nodes[0].body_summary).toContain(baseArgs.title);
    expect(nodes[0].body_summary).toContain("md hypertrophy");
  });

  it("occurred_on edge from decisions to day bucket", () => {
    const { edges } = buildDecisionNodes(baseArgs);
    expect(edges[0]).toMatchObject({
      edge_type: "occurred_on",
      src_kind: "decisions",
      tgt_kind: "time_buckets",
      tgt_id: "day:2026-05-06",
    });
  });

  it("metadata=null when no tags", () => {
    const { nodes } = buildDecisionNodes({ ...baseArgs, tags: null });
    expect(nodes[0].metadata).toBeNull();
  });
});
