/**
 * `traverse.ts` の unit test。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business fetchOneHop / traverse BFS の動作テスト。direction 別の SQL 構築、cycle 防止、max_depth 上限 (3 cap)、edge_type フィルタ、空 frontier での早期終了を検証
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

function jobReturning<T>(rows: T[]): unknown {
  return [{ getQueryResults: async () => [rows] }];
}

describe("fetchOneHop", () => {
  beforeEach(() => createQueryJobMock.mockReset());
  afterEach(() => vi.resetModules());

  it("direction=out → outgoing edges のみ取得 SQL", async () => {
    createQueryJobMock.mockResolvedValueOnce(jobReturning([]));
    const { fetchOneHop } = await import("./traverse.js");
    await fetchOneHop("persons", "p1", undefined, "out");
    const sql = createQueryJobMock.mock.calls[0][0].query;
    expect(sql).toContain("WHERE src_kind = @k AND src_id = @i");
    expect(sql).not.toContain("WHERE tgt_kind = @k AND tgt_id = @i");
  });

  it("direction=in → incoming edges のみ", async () => {
    createQueryJobMock.mockResolvedValueOnce(jobReturning([]));
    const { fetchOneHop } = await import("./traverse.js");
    await fetchOneHop("contents", "c1", undefined, "in");
    const sql = createQueryJobMock.mock.calls[0][0].query;
    expect(sql).toContain("WHERE tgt_kind = @k AND tgt_id = @i");
    expect(sql).not.toContain("WHERE src_kind = @k AND src_id = @i");
  });

  it("direction=both → 両方向の SQL", async () => {
    createQueryJobMock.mockResolvedValueOnce(jobReturning([]));
    const { fetchOneHop } = await import("./traverse.js");
    await fetchOneHop("persons", "p1", undefined, "both");
    const sql = createQueryJobMock.mock.calls[0][0].query;
    expect(sql).toContain("WHERE src_kind = @k AND src_id = @i");
    expect(sql).toContain("WHERE tgt_kind = @k AND tgt_id = @i");
  });

  it("edgeType フィルタを params に積む", async () => {
    createQueryJobMock.mockResolvedValueOnce(jobReturning([]));
    const { fetchOneHop } = await import("./traverse.js");
    await fetchOneHop("persons", "p1", "authored", "out");
    const args = createQueryJobMock.mock.calls[0][0];
    expect(args.params.et).toBe("authored");
    expect(args.query).toContain("AND edge_type = @et");
  });
});

describe("traverse (BFS)", () => {
  beforeEach(() => createQueryJobMock.mockReset());
  afterEach(() => vi.resetModules());

  it("起点から 1 hop 走査、空 result → 早期終了", async () => {
    createQueryJobMock.mockResolvedValue(jobReturning([]));
    const { traverse } = await import("./traverse.js");
    const out = await traverse({ kind: "persons", id: "p1", maxDepth: 2 });
    expect(out).toEqual([]);
    // depth 1 で空 frontier → break、SQL は 1 回だけ
    expect(createQueryJobMock).toHaveBeenCalledTimes(1);
  });

  it("max_depth 3 cap (4 を渡しても 3 で止まる)", async () => {
    // 各 hop で 1 つの new node を返す chain: p1 → c1 → d1 → e1 → ...
    let n = 0;
    createQueryJobMock.mockImplementation(async () => {
      const hop = n++;
      const rows = [
        {
          edge_table: "personal_edges",
          edge_type: "next",
          src_kind: hop === 0 ? "persons" : "contents",
          src_id: hop === 0 ? "p1" : `c${hop}`,
          tgt_kind: "contents",
          tgt_id: `c${hop + 1}`,
        },
      ];
      return jobReturning(rows);
    });
    const { traverse } = await import("./traverse.js");
    const out = await traverse({ kind: "persons", id: "p1", maxDepth: 4, direction: "out" });
    // 3 hop までで打ち切り → 3 edges
    expect(out.length).toBeLessThanOrEqual(3);
    expect(out.every((e) => e.depth <= 3)).toBe(true);
  });

  it("cycle 防止: 訪問済 node に再到達しても再 traverse しない", async () => {
    // p1 → c1 → p1 (cycle)
    let call = 0;
    createQueryJobMock.mockImplementation(async () => {
      call++;
      if (call === 1)
        return jobReturning([
          {
            edge_table: "personal_edges",
            edge_type: "x",
            src_kind: "persons",
            src_id: "p1",
            tgt_kind: "contents",
            tgt_id: "c1",
          },
        ]);
      if (call === 2)
        return jobReturning([
          {
            edge_table: "personal_edges",
            edge_type: "x",
            src_kind: "contents",
            src_id: "c1",
            tgt_kind: "persons",
            tgt_id: "p1",
          },
        ]);
      return jobReturning([]);
    });
    const { traverse } = await import("./traverse.js");
    const out = await traverse({ kind: "persons", id: "p1", maxDepth: 3, direction: "out" });
    expect(out).toHaveLength(2);
    // depth 3 を呼ぼうとしても visited set で frontier 空 → 早期終了
    expect(createQueryJobMock).toHaveBeenCalledTimes(2);
  });

  it("default direction=both, default maxDepth=2 が動く (引数省略パス)", async () => {
    createQueryJobMock.mockResolvedValue(jobReturning([]));
    const { traverse } = await import("./traverse.js");
    await traverse({ kind: "persons", id: "p1" });
    expect(createQueryJobMock).toHaveBeenCalledTimes(1);
  });
});
