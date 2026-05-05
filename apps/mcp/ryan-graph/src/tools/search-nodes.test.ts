/**
 * `search-nodes.ts` の unit test。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business buildPerTableSelect / searchNodes の純粋ロジック + BQ query 委任。embed 関数を inject、BigQuery を mock し、SQL 構築・kind フィルタ・limit を検証
 * @graph-connects none
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createQueryJobMock = vi.hoisted(() => vi.fn());
const embedTextMock = vi.hoisted(() => vi.fn());
vi.mock("@google-cloud/bigquery", () => {
  class FakeBigQuery {
    createQueryJob = createQueryJobMock;
  }
  return { BigQuery: FakeBigQuery };
});
vi.mock("@self/embedding", () => ({
  embedText: embedTextMock,
}));

describe("buildPerTableSelect", () => {
  it("contents → body_summary を含む SELECT", async () => {
    const { buildPerTableSelect } = await import("./search-nodes.js");
    const sql = buildPerTableSelect("contents");
    expect(sql).toContain("'contents' AS kind");
    expect(sql).toContain("content_id AS id");
    expect(sql).toContain("body_summary");
    expect(sql).toContain("ARRAY_LENGTH(embedding) > 0");
  });

  it("product_graph_nodes → description AS body_summary (column 名は alias で揃える)", async () => {
    const { buildPerTableSelect } = await import("./search-nodes.js");
    const sql = buildPerTableSelect("product_graph_nodes");
    // 内部 column は description だが alias は body_summary で出力 column 名統一
    expect(sql).toContain("description AS body_summary");
  });
});

describe("searchNodes", () => {
  beforeEach(() => {
    createQueryJobMock.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("kind 指定なし → 全 7 table の UNION ALL を組む、limit default=10、embed inject される", async () => {
    createQueryJobMock.mockResolvedValue([
      {
        getQueryResults: async () => [[{ kind: "contents", id: "c1", title: "t", body_summary: "s", cosine_distance: 0.1 }]],
      },
    ]);
    const fakeEmbed = vi.fn().mockResolvedValue([0.1, 0.2]);
    const { searchNodes } = await import("./search-nodes.js");
    const out = await searchNodes({ query: "test" }, fakeEmbed);
    expect(out).toHaveLength(1);
    expect(fakeEmbed).toHaveBeenCalledWith("test");
    const sqlArg = createQueryJobMock.mock.calls[0][0];
    expect(sqlArg.params.qvec).toEqual([0.1, 0.2]);
    expect(sqlArg.params.lim).toBe(10);
    // 7 tables UNION
    const unionCount = (sqlArg.query.match(/UNION ALL/g) ?? []).length;
    expect(unionCount).toBe(6); // 7 tables → 6 UNION ALL
  });

  it("kind 指定あり → 1 table のみ", async () => {
    createQueryJobMock.mockResolvedValue([
      {
        getQueryResults: async () => [[]],
      },
    ]);
    const fakeEmbed = vi.fn().mockResolvedValue([0]);
    const { searchNodes } = await import("./search-nodes.js");
    await searchNodes({ query: "x", kind: "decisions", limit: 5 }, fakeEmbed);
    const sqlArg = createQueryJobMock.mock.calls[0][0];
    expect(sqlArg.query).not.toContain("UNION ALL");
    expect(sqlArg.query).toContain("'decisions' AS kind");
    expect(sqlArg.params.lim).toBe(5);
  });

  it("default embed: 引数省略時は @self/embedding.embedText が呼ばれる", async () => {
    createQueryJobMock.mockResolvedValue([
      {
        getQueryResults: async () => [[]],
      },
    ]);
    embedTextMock.mockResolvedValue([0.7]);
    const { searchNodes } = await import("./search-nodes.js");
    await searchNodes({ query: "x" });
    expect(embedTextMock).toHaveBeenCalledWith("x", "RETRIEVAL_QUERY");
    const sqlArg = createQueryJobMock.mock.calls[0][0];
    expect(sqlArg.params.qvec).toEqual([0.7]);
  });
});
