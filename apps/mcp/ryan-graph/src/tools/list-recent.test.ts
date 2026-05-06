/**
 * `list-recent.ts` の unit test。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business listRecent / timeOrderColumn の純粋ロジック検証。kind 別の時系列 column 選択、since cutoff の有無、limit default、product_graph_nodes だけ description 列を使う特殊化を網羅
 * @graph-connects none
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createQueryJobMock = vi.hoisted(() => vi.fn());
vi.mock("@google-cloud/bigquery", () => {
  class FakeBigQuery {
    createQueryJob = createQueryJobMock;
  }
  return { BigQuery: FakeBigQuery };
});

describe("timeOrderColumn", () => {
  it.each([
    ["release_notes", "released_at"],
    ["decisions", "decided_at"],
    ["events", "occurred_at"],
    ["contents", "COALESCE(published_at, first_seen_at)"],
    ["topics", "first_seen_at"],
    ["persons", "first_seen_at"],
    ["product_graph_nodes", "first_seen_at"],
    ["engagement_decisions", "decided_at"],
    ["time_buckets", "start_date"],
    ["learnings", "realized_at"],
  ])("%s → %s", async (kind, expected) => {
    const { timeOrderColumn } = await import("./list-recent.js");
    expect(timeOrderColumn(kind as Parameters<typeof timeOrderColumn>[0])).toBe(expected);
  });
});

describe("listRecent", () => {
  beforeEach(() => createQueryJobMock.mockReset());
  afterEach(() => vi.resetModules());

  it("基本: kind=release_notes、limit default=20、SQL に released_at 含む", async () => {
    createQueryJobMock.mockResolvedValueOnce([
      { getQueryResults: async () => [[]] },
    ]);
    const { listRecent } = await import("./list-recent.js");
    await listRecent({ kind: "release_notes" });
    const args = createQueryJobMock.mock.calls[0][0];
    expect(args.query).toContain("released_at");
    expect(args.query).toContain("ORDER BY released_at DESC");
    expect(args.params.lim).toBe(20);
    expect(args.params.since).toBeUndefined();
  });

  it("since 指定 → WHERE 条件と params に since が乗る", async () => {
    createQueryJobMock.mockResolvedValueOnce([
      { getQueryResults: async () => [[]] },
    ]);
    const { listRecent } = await import("./list-recent.js");
    await listRecent({ kind: "decisions", since: "2026-05-01T00:00:00Z", limit: 5 });
    const args = createQueryJobMock.mock.calls[0][0];
    expect(args.query).toContain("WHERE decided_at >= @since");
    expect(args.params.since).toBe("2026-05-01T00:00:00Z");
    expect(args.params.lim).toBe(5);
  });

  it("product_graph_nodes は description 列を使う", async () => {
    createQueryJobMock.mockResolvedValueOnce([
      { getQueryResults: async () => [[]] },
    ]);
    const { listRecent } = await import("./list-recent.js");
    await listRecent({ kind: "product_graph_nodes" });
    const sql = createQueryJobMock.mock.calls[0][0].query;
    expect(sql).toContain("description AS body_summary");
  });

  it("persons は bio 列を summary に使う (body_summary 列不在の fallback)", async () => {
    createQueryJobMock.mockResolvedValueOnce([
      { getQueryResults: async () => [[]] },
    ]);
    const { listRecent } = await import("./list-recent.js");
    await listRecent({ kind: "persons" });
    const sql = createQueryJobMock.mock.calls[0][0].query;
    expect(sql).toContain("bio AS body_summary");
  });

  it("decisions は rationale_md を summary に使う", async () => {
    createQueryJobMock.mockResolvedValueOnce([
      { getQueryResults: async () => [[]] },
    ]);
    const { listRecent } = await import("./list-recent.js");
    await listRecent({ kind: "decisions" });
    const sql = createQueryJobMock.mock.calls[0][0].query;
    expect(sql).toContain("rationale_md AS body_summary");
  });

  it("結果配列がそのまま返る", async () => {
    createQueryJobMock.mockResolvedValueOnce([
      {
        getQueryResults: async () => [
          [{ id: "r1", title: "T", body_summary: null, ts: "2026-05-04" }],
        ],
      },
    ]);
    const { listRecent } = await import("./list-recent.js");
    const out = await listRecent({ kind: "release_notes" });
    expect(out).toEqual([{ id: "r1", title: "T", body_summary: null, ts: "2026-05-04" }]);
  });
});
