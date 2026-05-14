/**
 * `since.ts` の unit test (BigQuery client を inject して mock)。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business KIND_FILTER と getLastSeenTweetId の純粋ロジックを mock BigQuery で検証。SQL に account/kind が反映されること、null/値ありの両 path を網羅
 * @graph-connects none
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  KIND_FILTER,
  defaultBqClient,
  getLastSeenTweetId,
  resolveProjectId,
  type BqQueryClient,
} from "./since.js";

function makeMockClient(rows: Array<Record<string, unknown>>): {
  client: BqQueryClient;
  capturedQuery: { value: string | null };
  capturedParams: { value: Record<string, unknown> | null };
} {
  const capturedQuery = { value: null as string | null };
  const capturedParams = { value: null as Record<string, unknown> | null };
  const client: BqQueryClient = {
    createQueryJob: vi.fn(async (req) => {
      capturedQuery.value = req.query;
      capturedParams.value = req.params ?? null;
      return [
        {
          getQueryResults: async () => [rows],
        },
      ] as Awaited<ReturnType<BqQueryClient["createQueryJob"]>>;
    }),
  };
  return { client, capturedQuery, capturedParams };
}

describe("KIND_FILTER", () => {
  it("own kind filters by source='x_post' + account", () => {
    expect(KIND_FILTER.own).toContain("$.source");
    expect(KIND_FILTER.own).toContain("x_post");
    expect(KIND_FILTER.own).toContain("$.account");
  });

  it("mention kind filters by source='x_external' + engagement='mention' + ingested_for", () => {
    expect(KIND_FILTER.mention).toContain("x_external");
    expect(KIND_FILTER.mention).toContain("mention");
    expect(KIND_FILTER.mention).toContain("$.ingested_for");
  });
});

describe("resolveProjectId", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses GOOGLE_CLOUD_PROJECT env when set", () => {
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "my-custom-project");
    expect(resolveProjectId()).toBe("my-custom-project");
  });

  it("falls back to ryan-self-management when env unset", () => {
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", undefined);
    expect(resolveProjectId()).toBe("ryan-self-management");
  });
});

describe("defaultBqClient", () => {
  it("returns a non-null client (real BigQuery instance)", () => {
    expect(defaultBqClient()).toBeDefined();
  });
});

describe("getLastSeenTweetId", () => {
  it("returns the max_id when contents row exists for that (account, kind)", async () => {
    const { client, capturedQuery, capturedParams } = makeMockClient([{ max_id: "1234567890" }]);
    const out = await getLastSeenTweetId("ryantsuji", "own", client);
    expect(out).toBe("1234567890");
    expect(capturedQuery.value).toContain("MAX(CAST(external_id AS NUMERIC))");
    expect(capturedQuery.value).toContain("FROM `");
    expect(capturedQuery.value).toContain(".contents`");
    expect(capturedQuery.value).toContain("source = 'x'");
    expect(capturedQuery.value).toContain("x_post");
    expect(capturedParams.value).toEqual({ account: "ryantsuji" });
  });

  it("uses mention KIND_FILTER for kind='mention'", async () => {
    const { client, capturedQuery } = makeMockClient([{ max_id: "999" }]);
    await getLastSeenTweetId("ryanaircloset", "mention", client);
    expect(capturedQuery.value).toContain("x_external");
    expect(capturedQuery.value).toContain("'mention'");
  });

  it("returns null when no rows match (initial run)", async () => {
    const { client } = makeMockClient([{ max_id: null }]);
    const out = await getLastSeenTweetId("ryantsuji", "own", client);
    expect(out).toBeNull();
  });

  it("returns null when query result row is empty", async () => {
    const { client } = makeMockClient([]);
    const out = await getLastSeenTweetId("ryantsuji", "own", client);
    expect(out).toBeNull();
  });

  it("returns null when max_id is empty string (defensive)", async () => {
    const { client } = makeMockClient([{ max_id: "" }]);
    const out = await getLastSeenTweetId("ryantsuji", "own", client);
    expect(out).toBeNull();
  });
});
