/**
 * `bq.ts` の constants + factory のテスト。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business BQ helper の純粋部分 (NODE_TABLES / PK_COLUMN / TITLE_EXPR / getBq シングルトン / query mock 注入) を smoke 検証
 * @graph-connects none
 */

import { describe, expect, it, vi, afterEach } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("@google-cloud/bigquery", () => {
  class FakeBigQuery {
    location?: string;
    constructor(opts: { location?: string }) {
      this.location = opts?.location;
    }
    createQueryJob = vi.fn().mockImplementation(async (input) => {
      queryMock(input);
      return [
        {
          getQueryResults: async () => [[{ ok: true }]],
        },
      ];
    });
  }
  return { BigQuery: FakeBigQuery };
});

describe("bq constants", () => {
  it("PROJECT_ID は env 未設定時に fallback 'ryan-self-management'", async () => {
    const orig = process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    vi.resetModules();
    try {
      const { PROJECT_ID } = await import("./bq.js");
      expect(PROJECT_ID).toBe("ryan-self-management");
    } finally {
      if (orig !== undefined) process.env.GOOGLE_CLOUD_PROJECT = orig;
    }
  });

  it("PROJECT_ID は env が立っていればその値", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "test-from-env";
    vi.resetModules();
    try {
      const { PROJECT_ID } = await import("./bq.js");
      expect(PROJECT_ID).toBe("test-from-env");
    } finally {
      delete process.env.GOOGLE_CLOUD_PROJECT;
    }
  });

  it("NODE_TABLES に 10 つの table 名が並ぶ", async () => {
    const { NODE_TABLES } = await import("./bq.js");
    expect(NODE_TABLES).toHaveLength(10);
    expect(NODE_TABLES).toContain("time_buckets");
    expect(NODE_TABLES).toContain("engagement_decisions");
    expect(NODE_TABLES).toContain("learnings");
  });

  it("PK_COLUMN は全 NODE_TABLES key を網羅", async () => {
    const { NODE_TABLES, PK_COLUMN } = await import("./bq.js");
    for (const t of NODE_TABLES) {
      expect(PK_COLUMN[t]).toBeDefined();
      expect(typeof PK_COLUMN[t]).toBe("string");
    }
  });

  it("TITLE_EXPR は全 NODE_TABLES key を網羅", async () => {
    const { NODE_TABLES, TITLE_EXPR } = await import("./bq.js");
    for (const t of NODE_TABLES) {
      expect(TITLE_EXPR[t]).toBeDefined();
    }
  });
});

describe("getBq / query / _setBqForTest", () => {
  afterEach(async () => {
    const { _setBqForTest } = await import("./bq.js");
    _setBqForTest(null);
    queryMock.mockReset();
  });

  it("getBq は同じ instance を返す (singleton)", async () => {
    const { getBq } = await import("./bq.js");
    const a = getBq();
    const b = getBq();
    expect(a).toBe(b);
  });

  it("query は createQueryJob → getQueryResults の rows を返す", async () => {
    const { query } = await import("./bq.js");
    const rows = await query<{ ok: boolean }>("SELECT 1", { x: 2 });
    expect(rows).toEqual([{ ok: true }]);
    expect(queryMock).toHaveBeenCalledOnce();
    const args = queryMock.mock.calls[0][0];
    expect(args.query).toBe("SELECT 1");
    expect(args.params).toEqual({ x: 2 });
  });

  it("_setBqForTest で client を差し替え可能", async () => {
    const { _setBqForTest, getBq } = await import("./bq.js");
    const fake = { sentinel: 1 } as unknown as ReturnType<typeof getBq>;
    _setBqForTest(fake);
    expect(getBq()).toBe(fake);
  });
});
