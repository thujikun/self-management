/**
 * `same-entity.ts` の unit test (cosine 計算 + cross-source filter +
 * published_at 近接 filter)。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business cosineSimilarity / findSameEntityPairs / pairsToEdges /
 * loadContentsWithEmbedding / parseSameEntity の網羅
 * @graph-connects none
 */

import { describe, expect, it, vi } from "vitest";
import {
  cosineSimilarity,
  defaultBqClient,
  findSameEntityPairs,
  loadContentsWithEmbedding,
  pairsToEdges,
  parseSameEntity,
  type BqQueryClient,
  type ContentEmbeddingRow,
} from "./same-entity.js";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 6);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it("returns negative for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 6);
  });

  it("returns 0 when either vector is zero (avoids div-by-zero)", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([1, 1], [0, 0])).toBe(0);
  });

  it("computes intermediate value", () => {
    expect(cosineSimilarity([1, 1], [1, 0])).toBeCloseTo(1 / Math.sqrt(2), 6);
  });
});

function row(
  id: string,
  source: string,
  published_at: string,
  embedding: number[],
): ContentEmbeddingRow {
  return { content_id: id, source, published_at, embedding };
}

describe("findSameEntityPairs", () => {
  it("matches cross-source pair within sim and days threshold", () => {
    const rows = [
      row("a", "zenn", "2026-04-01T00:00:00Z", [1, 0]),
      row("b", "devto", "2026-04-01T12:00:00Z", [1, 0]),
    ];
    const pairs = findSameEntityPairs(rows);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].src_id).toBe("a");
    expect(pairs[0].tgt_id).toBe("b");
    expect(pairs[0].similarity).toBeCloseTo(1, 6);
    expect(pairs[0].daysDiff).toBeCloseTo(0.5, 2);
  });

  it("excludes same-source pairs", () => {
    const rows = [
      row("a", "zenn", "2026-04-01T00:00:00Z", [1, 0]),
      row("b", "zenn", "2026-04-01T01:00:00Z", [1, 0]),
    ];
    expect(findSameEntityPairs(rows)).toEqual([]);
  });

  it("excludes pairs whose source is not eligible (default: x is excluded)", () => {
    const rows = [
      row("a", "x", "2026-04-01T00:00:00Z", [1, 0]),
      row("b", "zenn", "2026-04-01T01:00:00Z", [1, 0]),
    ];
    expect(findSameEntityPairs(rows)).toEqual([]);
  });

  it("respects custom eligibleSources opt", () => {
    const rows = [
      row("a", "medium", "2026-04-01T00:00:00Z", [1, 0]),
      row("b", "zenn", "2026-04-01T01:00:00Z", [1, 0]),
    ];
    // default だと medium は対象外 → 0 件
    expect(findSameEntityPairs(rows)).toHaveLength(0);
    // medium を含めれば検出
    expect(findSameEntityPairs(rows, { eligibleSources: ["zenn", "medium"] })).toHaveLength(1);
  });

  it("excludes pairs below sim threshold", () => {
    const rows = [
      row("a", "zenn", "2026-04-01T00:00:00Z", [1, 0]),
      row("b", "devto", "2026-04-01T00:00:00Z", [0, 1]), // sim=0
    ];
    expect(findSameEntityPairs(rows, { simThreshold: 0.5 })).toEqual([]);
  });

  it("excludes pairs beyond max days", () => {
    const rows = [
      row("a", "zenn", "2026-04-01T00:00:00Z", [1, 0]),
      row("b", "devto", "2026-04-10T00:00:00Z", [1, 0]), // 9 days
    ];
    expect(findSameEntityPairs(rows, { maxDays: 2 })).toEqual([]);
  });

  it("uses default thresholds when not specified", () => {
    const rows = [
      row("a", "zenn", "2026-04-01T00:00:00Z", [1, 0]),
      row("b", "devto", "2026-04-01T01:00:00Z", [1, 0]),
    ];
    const pairs = findSameEntityPairs(rows);
    expect(pairs).toHaveLength(1);
  });

  it("orders src/tgt deterministically by content_id", () => {
    const rows = [
      row("z", "zenn", "2026-04-01T00:00:00Z", [1, 0]),
      row("a", "devto", "2026-04-01T01:00:00Z", [1, 0]),
    ];
    const pairs = findSameEntityPairs(rows);
    expect(pairs[0].src_id).toBe("a");
    expect(pairs[0].tgt_id).toBe("z");
  });

  it("returns empty for empty input", () => {
    expect(findSameEntityPairs([])).toEqual([]);
  });
});

describe("pairsToEdges", () => {
  it("converts pairs to same_entity edges with correct properties", () => {
    const edges = pairsToEdges([
      { src_id: "a", tgt_id: "b", similarity: 0.876543, daysDiff: 0.123 },
    ]);
    expect(edges).toHaveLength(1);
    const e = edges[0];
    expect(e.edge_table).toBe("personal_edges");
    expect(e.edge_type).toBe("same_entity");
    expect(e.src_kind).toBe("contents");
    expect(e.tgt_kind).toBe("contents");
    expect(e.src_id).toBe("a");
    expect(e.tgt_id).toBe("b");
    const props = e.properties as { via: string; similarity: number; days_diff: number };
    expect(props.via).toBe("embedding_cosine");
    expect(props.similarity).toBe(0.8765);
    expect(props.days_diff).toBe(0.12);
  });

  it("returns empty array for no pairs", () => {
    expect(pairsToEdges([])).toEqual([]);
  });
});

describe("defaultBqClient", () => {
  it("returns a BigQuery instance with createQueryJob", () => {
    expect(typeof defaultBqClient().createQueryJob).toBe("function");
  });
});

function makeMockClient(rows: Array<Record<string, unknown>>): BqQueryClient {
  return {
    createQueryJob: vi.fn(
      async () =>
        [{ getQueryResults: async () => [rows] }] as Awaited<
          ReturnType<BqQueryClient["createQueryJob"]>
        >,
    ),
  };
}

describe("loadContentsWithEmbedding", () => {
  it("returns parsed rows with normalized published_at and embedding", async () => {
    const client = makeMockClient([
      {
        content_id: "c1",
        source: "zenn",
        published_at: "2026-04-01T00:00:00Z",
        embedding: [0.1, 0.2, 0.3],
      },
      {
        content_id: "c2",
        source: "devto",
        published_at: { value: "2026-04-02T00:00:00Z" },
        embedding: [0.4, 0.5, 0.6],
      },
    ]);
    const out = await loadContentsWithEmbedding(client);
    expect(out).toHaveLength(2);
    expect(out[0].published_at).toBe("2026-04-01T00:00:00Z");
    expect(out[1].published_at).toBe("2026-04-02T00:00:00Z");
    expect(out[1].embedding).toEqual([0.4, 0.5, 0.6]);
  });

  it("skips rows with non-string content_id or source", async () => {
    const client = makeMockClient([
      { content_id: null, source: "zenn", published_at: "2026-04-01T00:00:00Z", embedding: [1] },
      { content_id: "c1", source: null, published_at: "2026-04-01T00:00:00Z", embedding: [1] },
      { content_id: "ok", source: "zenn", published_at: "2026-04-01T00:00:00Z", embedding: [1] },
    ]);
    const out = await loadContentsWithEmbedding(client);
    expect(out).toHaveLength(1);
    expect(out[0].content_id).toBe("ok");
  });

  it("skips rows with invalid published_at", async () => {
    const client = makeMockClient([
      { content_id: "c1", source: "zenn", published_at: null, embedding: [1] },
      { content_id: "c2", source: "zenn", published_at: { value: null }, embedding: [1] },
      { content_id: "c3", source: "zenn", published_at: "2026-04-01T00:00:00Z", embedding: [1] },
    ]);
    const out = await loadContentsWithEmbedding(client);
    expect(out).toHaveLength(1);
    expect(out[0].content_id).toBe("c3");
  });

  it("skips rows with non-array or non-finite embedding", async () => {
    const client = makeMockClient([
      { content_id: "c1", source: "zenn", published_at: "2026-04-01T00:00:00Z", embedding: "bad" },
      {
        content_id: "c2",
        source: "zenn",
        published_at: "2026-04-01T00:00:00Z",
        embedding: [Number.NaN, 1],
      },
      { content_id: "c3", source: "zenn", published_at: "2026-04-01T00:00:00Z", embedding: [1, 2] },
    ]);
    const out = await loadContentsWithEmbedding(client);
    expect(out).toHaveLength(1);
    expect(out[0].content_id).toBe("c3");
  });
});

describe("parseSameEntity", () => {
  it("end-to-end: BQ rows → cross-source pair → same_entity edge", async () => {
    const client = makeMockClient([
      {
        content_id: "z1",
        source: "zenn",
        published_at: "2026-04-01T00:00:00Z",
        embedding: [1, 0, 0],
      },
      {
        content_id: "d1",
        source: "devto",
        published_at: "2026-04-01T06:00:00Z",
        embedding: [1, 0, 0],
      },
      {
        content_id: "z2",
        source: "zenn",
        published_at: "2026-04-01T00:00:00Z",
        embedding: [0, 1, 0], // 別記事 (sim=0)
      },
    ]);
    const result = await parseSameEntity({ client });
    expect(result.source).toBe("same-entity");
    expect(result.nodes).toEqual([]);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].edge_type).toBe("same_entity");
    expect(result.edges[0].src_id).toBe("d1");
    expect(result.edges[0].tgt_id).toBe("z1");
  });

  it("forwards eligibleSources opt", async () => {
    const client = makeMockClient([
      {
        content_id: "x1",
        source: "x",
        published_at: "2026-04-01T00:00:00Z",
        embedding: [1, 0],
      },
      {
        content_id: "z1",
        source: "zenn",
        published_at: "2026-04-01T01:00:00Z",
        embedding: [1, 0],
      },
    ]);
    // default では x ↔ zenn は対象外
    const r0 = await parseSameEntity({ client });
    expect(r0.edges).toHaveLength(0);
    // x を eligible に含めれば検出
    const r1 = await parseSameEntity({ client, eligibleSources: ["x", "zenn"] });
    expect(r1.edges).toHaveLength(1);
  });

  it("forwards simThreshold and maxDays opts", async () => {
    const client = makeMockClient([
      {
        content_id: "a",
        source: "zenn",
        published_at: "2026-04-01T00:00:00Z",
        embedding: [1, 0],
      },
      {
        content_id: "b",
        source: "devto",
        published_at: "2026-04-01T12:00:00Z",
        embedding: [0.9, 0.1],
      },
    ]);
    // strict threshold should drop the pair (sim ~0.99 but threshold 0.999 excludes)
    const r1 = await parseSameEntity({ client, simThreshold: 0.999 });
    expect(r1.edges).toHaveLength(0);
    // strict maxDays should drop the pair (0.5 days > 0.1)
    const r2 = await parseSameEntity({ client, maxDays: 0.1 });
    expect(r2.edges).toHaveLength(0);
  });
});
