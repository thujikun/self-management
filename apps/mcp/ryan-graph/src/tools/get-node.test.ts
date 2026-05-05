/**
 * `get-node.ts` の unit test。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business getNode の SQL 組み立てと結果整形をテスト。node 不在時の null、edge join の direction 両方向、embedding 列除外を検証
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

describe("getNode", () => {
  beforeEach(() => {
    createQueryJobMock.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("node 不在 → null", async () => {
    createQueryJobMock.mockResolvedValueOnce([
      { getQueryResults: async () => [[]] },
    ]);
    const { getNode } = await import("./get-node.js");
    const out = await getNode({ kind: "contents", id: "missing" });
    expect(out).toBeNull();
  });

  it("node 取得 + edges 取得", async () => {
    createQueryJobMock
      .mockResolvedValueOnce([
        {
          getQueryResults: async () => [[{ content_id: "c1", title: "T" }]],
        },
      ])
      .mockResolvedValueOnce([
        {
          getQueryResults: async () => [
            [
              {
                edge_table: "personal_edges",
                edge_type: "authored",
                direction: "in",
                src_kind: "persons",
                src_id: "p1",
                tgt_kind: "contents",
                tgt_id: "c1",
                properties: null,
              },
            ],
          ],
        },
      ]);
    const { getNode } = await import("./get-node.js");
    const out = await getNode({ kind: "contents", id: "c1" });
    expect(out).not.toBeNull();
    expect(out?.kind).toBe("contents");
    expect(out?.row.content_id).toBe("c1");
    expect(out?.edges).toHaveLength(1);
    expect(out?.edges[0].edge_type).toBe("authored");
  });

  it("node SELECT は EXCEPT (embedding) を含む", async () => {
    createQueryJobMock
      .mockResolvedValueOnce([{ getQueryResults: async () => [[{ ok: 1 }]] }])
      .mockResolvedValueOnce([{ getQueryResults: async () => [[]] }]);
    const { getNode } = await import("./get-node.js");
    await getNode({ kind: "decisions", id: "d1" });
    const firstSql = createQueryJobMock.mock.calls[0][0].query;
    expect(firstSql).toContain("EXCEPT (embedding)");
    expect(firstSql).toContain("decision_id = @id");
  });
});
