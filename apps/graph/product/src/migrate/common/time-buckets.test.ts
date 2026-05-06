/**
 * time-buckets.ts の unit tests。ISO 8601 規則と bucket_id 整合性を検証。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business 時間軸 anchor 計算の正確性 (ISO 8601 週判定、月境界、bucket_id format) と node/edge 構築の整合性をテスト。biz-graph と同思想で全 activity が day → week → month に anchor される前提を担保
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";
import {
  buildActivityAnchor,
  buildBucketNodes,
  computeBucketIds,
  dayBucketId,
  isoDate,
  isoWeek,
  isoWeekStart,
  monthBucketId,
  weekBucketId,
  weekdayName,
} from "./time-buckets.js";

describe("dayBucketId", () => {
  it("returns day:YYYY-MM-DD format (UTC)", () => {
    expect(dayBucketId(new Date("2026-05-06T12:00:00Z"))).toBe("day:2026-05-06");
  });

  it("zero pads month and day", () => {
    expect(dayBucketId(new Date("2026-01-03T00:00:00Z"))).toBe("day:2026-01-03");
  });
});

describe("monthBucketId", () => {
  it("returns month:YYYY-MM format", () => {
    expect(monthBucketId(new Date("2026-05-06T12:00:00Z"))).toBe("month:2026-05");
  });
});

describe("isoWeek", () => {
  it("2026-05-06 (Wed) is in 2026 week 19", () => {
    expect(isoWeek(new Date("2026-05-06T00:00:00Z"))).toEqual({ year: 2026, week: 19 });
  });

  it("2026-01-01 (Thu) is in 2026 week 1", () => {
    expect(isoWeek(new Date("2026-01-01T00:00:00Z"))).toEqual({ year: 2026, week: 1 });
  });

  it("2025-12-31 (Wed) is in 2026 week 1 (year boundary case)", () => {
    expect(isoWeek(new Date("2025-12-31T00:00:00Z"))).toEqual({ year: 2026, week: 1 });
  });

  it("2024-12-30 (Mon) is in 2025 week 1", () => {
    expect(isoWeek(new Date("2024-12-30T00:00:00Z"))).toEqual({ year: 2025, week: 1 });
  });

  it("Sunday hits the dayNum=7 fallback (getUTCDay() || 7 branch)", () => {
    // 2026-05-10 は日曜、ISO 週としては W19 (前日土曜と同じ週)
    expect(isoWeek(new Date("2026-05-10T00:00:00Z"))).toEqual({ year: 2026, week: 19 });
  });
});

describe("weekBucketId", () => {
  it("returns week:YYYY-Www format with zero-padded week", () => {
    expect(weekBucketId(new Date("2026-05-06T00:00:00Z"))).toBe("week:2026-W19");
    expect(weekBucketId(new Date("2026-01-05T00:00:00Z"))).toBe("week:2026-W02");
  });
});

describe("computeBucketIds", () => {
  it("returns all 3 ids for 2026-05-06", () => {
    expect(computeBucketIds(new Date("2026-05-06T12:00:00Z"))).toEqual({
      day: "day:2026-05-06",
      week: "week:2026-W19",
      month: "month:2026-05",
    });
  });
});

describe("isoWeekStart", () => {
  it("Monday-aligned week start for Wed 2026-05-06 → Mon 2026-05-04", () => {
    const start = isoWeekStart(new Date("2026-05-06T12:00:00Z"));
    expect(isoDate(start)).toBe("2026-05-04");
  });

  it("Sunday 2026-05-10 → previous Mon 2026-05-04", () => {
    const start = isoWeekStart(new Date("2026-05-10T12:00:00Z"));
    expect(isoDate(start)).toBe("2026-05-04");
  });

  it("Monday itself stays the same", () => {
    const start = isoWeekStart(new Date("2026-05-04T12:00:00Z"));
    expect(isoDate(start)).toBe("2026-05-04");
  });
});

describe("weekdayName", () => {
  it("returns 3-letter abbreviation", () => {
    expect(weekdayName(new Date("2026-05-04T12:00:00Z"))).toBe("Mon");
    expect(weekdayName(new Date("2026-05-06T12:00:00Z"))).toBe("Wed");
    expect(weekdayName(new Date("2026-05-10T12:00:00Z"))).toBe("Sun");
  });
});

describe("buildBucketNodes", () => {
  const date = new Date("2026-05-06T15:04:12Z"); // Wed
  const built = buildBucketNodes(date);

  it("emits 3 nodes (day / week / month)", () => {
    expect(built.nodes).toHaveLength(3);
    expect(built.nodes.map((n) => n.fields.granularity)).toEqual(["day", "week", "month"]);
  });

  it("day node has correct bucket_id, label, parent", () => {
    const day = built.nodes[0];
    expect(day.id).toBe("day:2026-05-06");
    expect(day.fields.bucket_id).toBe("day:2026-05-06");
    expect(day.fields.start_date).toBe("2026-05-06");
    expect(day.fields.end_date).toBe("2026-05-06");
    expect(day.fields.label).toBe("2026-05-06 (Wed)");
    expect(day.fields.parent_bucket_id).toBe("week:2026-W19");
  });

  it("week node spans Mon 5/4 to Sun 5/10, parent=month", () => {
    const week = built.nodes[1];
    expect(week.id).toBe("week:2026-W19");
    expect(week.fields.start_date).toBe("2026-05-04");
    expect(week.fields.end_date).toBe("2026-05-10");
    expect(week.fields.parent_bucket_id).toBe("month:2026-05");
  });

  it("month node spans 2026-05-01 to 2026-05-31, parent=null", () => {
    const month = built.nodes[2];
    expect(month.id).toBe("month:2026-05");
    expect(month.fields.start_date).toBe("2026-05-01");
    expect(month.fields.end_date).toBe("2026-05-31");
    expect(month.fields.parent_bucket_id).toBeNull();
    expect(month.fields.label).toBe("May 2026");
  });

  it("emits 2 rolls_up_to edges (day→week, week→month)", () => {
    expect(built.edges).toHaveLength(2);
    expect(built.edges[0]).toMatchObject({
      edge_type: "rolls_up_to",
      src_kind: "time_buckets",
      src_id: "day:2026-05-06",
      tgt_kind: "time_buckets",
      tgt_id: "week:2026-W19",
    });
    expect(built.edges[1]).toMatchObject({
      edge_type: "rolls_up_to",
      src_kind: "time_buckets",
      src_id: "week:2026-W19",
      tgt_kind: "time_buckets",
      tgt_id: "month:2026-05",
    });
  });
});

describe("buildActivityAnchor", () => {
  it("returns 3 bucket nodes and 3 edges (1 occurred_on + 2 rolls_up_to)", () => {
    const date = new Date("2026-05-06T15:00:00Z");
    const out = buildActivityAnchor("decisions", "dec-1", date);
    expect(out.nodes).toHaveLength(3);
    expect(out.edges).toHaveLength(3);
    expect(out.edges[0]).toMatchObject({
      edge_type: "occurred_on",
      src_kind: "decisions",
      src_id: "dec-1",
      tgt_kind: "time_buckets",
      tgt_id: "day:2026-05-06",
    });
    expect(out.edges[1].edge_type).toBe("rolls_up_to");
  });

  it("works for any node table kind", () => {
    const date = new Date("2026-05-06T00:00:00Z");
    const out = buildActivityAnchor("learnings", "learn-1", date);
    expect(out.edges[0].src_kind).toBe("learnings");
    expect(out.edges[0].tgt_id).toBe("day:2026-05-06");
  });
});
