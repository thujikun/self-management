/**
 * `devto.ts` の unit test (fake fetch、fixture-based)。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business fetchDevtoArticles / fetchDevtoBody / devtoArticleToNode / parseDevto の純粋ロジックを fake fetch で網羅。pagination break 条件 / body fallback / authored edge を検証
 * @graph-connects none
 */

import { describe, expect, it, vi } from "vitest";
import { deterministicId } from "../common/id.js";
import { SELF_PERSON_ID } from "./threads.js";
import {
  buildDevtoDetailUrl,
  defaultDevtoUsername,
  defaultFetcher,
  devtoArticleToNode,
  fetchDevtoArticles,
  fetchDevtoBody,
  isNonEmptyText,
  parseDevto,
  trimBody,
  type DevtoListArticle,
  type FetchFn,
} from "./devto.js";

function fakeOk(body: unknown): ReturnType<FetchFn> {
  return Promise.resolve({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
    json: async () => body,
  });
}

function fakeErr(status: number, body: string): ReturnType<FetchFn> {
  return Promise.resolve({
    ok: false,
    status,
    text: async () => body,
    json: async () => ({}),
  });
}

const sampleArticle: DevtoListArticle = {
  id: 555,
  title: "17 MCP Servers",
  description: "How we run an Agentic Graph RAG over our codebase + DBs",
  slug: "17-mcp-servers",
  url: "https://dev.to/thujikun/17-mcp-servers-abc",
  published_at: "2026-04-01T00:00:00.000Z",
  tag_list: ["mcp", "ai", "graph"],
  positive_reactions_count: 23,
  comments_count: 5,
  reading_time_minutes: 8,
};

describe("defaultFetcher", () => {
  it("returns globalThis.fetch as FetchFn", () => {
    expect(typeof defaultFetcher()).toBe("function");
  });
});

describe("isNonEmptyText", () => {
  it("returns true for non-empty strings", () => {
    expect(isNonEmptyText("x")).toBe(true);
  });
  it("returns false for empty / null / undefined", () => {
    expect(isNonEmptyText("")).toBe(false);
    expect(isNonEmptyText(null)).toBe(false);
    expect(isNonEmptyText(undefined)).toBe(false);
  });
});

describe("defaultDevtoUsername", () => {
  it("returns Ryan's dev.to handle", () => {
    expect(defaultDevtoUsername()).toBe("ryosuke_tsuji_f08e20fdca1");
  });
});

describe("buildDevtoDetailUrl", () => {
  it("returns dev.to /api/articles/{id} URL", () => {
    expect(buildDevtoDetailUrl(99)).toBe("https://dev.to/api/articles/99");
  });
});

describe("trimBody", () => {
  it("collapses whitespace and trims", () => {
    expect(trimBody("  hello\n\nworld  ")).toBe("hello world");
  });
});

describe("fetchDevtoArticles", () => {
  it("paginates until result count < per_page (= last page)", async () => {
    const page1 = Array.from({ length: 30 }, (_, i) => ({ ...sampleArticle, id: i + 1 }));
    const page2 = Array.from({ length: 15 }, (_, i) => ({ ...sampleArticle, id: i + 100 }));
    let i = 0;
    const fetcher = vi.fn().mockImplementation(() => fakeOk(i++ === 0 ? page1 : page2));
    const out = await fetchDevtoArticles("thujikun", fetcher as FetchFn);
    expect(out).toHaveLength(45);
    // 2 calls (page=1 が full page なので page=2、page=2 で <30 のため打切り)
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("stops on empty array even when full per_page on prior page", async () => {
    const page1 = Array.from({ length: 30 }, (_, i) => ({ ...sampleArticle, id: i + 1 }));
    let i = 0;
    const fetcher = vi.fn().mockImplementation(() => fakeOk(i++ === 0 ? page1 : []));
    const out = await fetchDevtoArticles("thujikun", fetcher as FetchFn);
    expect(out).toHaveLength(30);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("URL-encodes the username", async () => {
    const fetcher = vi.fn().mockReturnValue(fakeOk([]));
    await fetchDevtoArticles("a/b c", fetcher as FetchFn);
    expect(fetcher.mock.calls[0][0]).toContain("username=a%2Fb%20c");
  });

  it("throws on non-ok with status + body excerpt", async () => {
    const fetcher = vi.fn().mockReturnValue(fakeErr(429, "rate"));
    await expect(fetchDevtoArticles("thujikun", fetcher as FetchFn)).rejects.toThrow(
      /429.*rate/,
    );
  });

  it("returns [] when response is not an array", async () => {
    const fetcher = vi.fn().mockReturnValue(fakeOk({ error: "x" }));
    expect(await fetchDevtoArticles("thujikun", fetcher as FetchFn)).toEqual([]);
  });
});

describe("fetchDevtoBody", () => {
  it("returns body_markdown when present", async () => {
    const fetcher = vi.fn().mockReturnValue(fakeOk({ body_markdown: "# title\nbody" }));
    expect(await fetchDevtoBody(123, fetcher as FetchFn)).toBe("# title\nbody");
  });

  it("returns empty string when body_markdown missing", async () => {
    const fetcher = vi.fn().mockReturnValue(fakeOk({ id: 123 }));
    expect(await fetchDevtoBody(123, fetcher as FetchFn)).toBe("");
  });

  it("returns empty string on non-ok", async () => {
    const fetcher = vi.fn().mockReturnValue(fakeErr(404, "not found"));
    expect(await fetchDevtoBody(123, fetcher as FetchFn)).toBe("");
  });
});

describe("devtoArticleToNode", () => {
  it("builds correct content node fields with deterministic id", () => {
    const node = devtoArticleToNode(sampleArticle, "本文", "thujikun");
    expect(node.kind).toBe("contents");
    expect(node.id).toBe(deterministicId("devto", "555"));
    expect(node.fields.source).toBe("devto");
    expect(node.fields.url).toBe("https://dev.to/thujikun/17-mcp-servers-abc");
    expect(node.fields.author_person_id).toBe(SELF_PERSON_ID);
    expect(node.fields.body_md).toBe("本文");
    expect(node.fields.published_at).toBe("2026-04-01T00:00:00.000Z");
  });

  it("body_summary contains title + description + body excerpt", () => {
    const node = devtoArticleToNode(sampleArticle, "Body content here", "thujikun");
    const s = node.body_summary as string;
    expect(s).toContain("17 MCP Servers");
    expect(s).toContain("Agentic Graph RAG");
    expect(s).toContain("Body content here");
  });

  it("falls back to description when body is empty (body_md non-empty)", () => {
    const node = devtoArticleToNode(sampleArticle, "", "thujikun");
    expect(node.fields.body_md).toBe(sampleArticle.description);
  });

  it("body_md falls back to description→empty when both body and description missing", () => {
    const minimal: DevtoListArticle = {
      id: 1,
      title: "t",
      slug: "s",
      url: "https://x",
      published_at: "2026-01-01T00:00:00Z",
    };
    const node = devtoArticleToNode(minimal, "", "u");
    expect(node.fields.body_md).toBe("");
  });

  it("description.trim() handles undefined description gracefully", () => {
    const minimal: DevtoListArticle = {
      id: 2,
      title: "t",
      slug: "s",
      url: "https://x",
      published_at: "2026-01-01T00:00:00Z",
    };
    const node = devtoArticleToNode(minimal, "B", "u");
    const md = node.metadata as Record<string, unknown>;
    expect(md.tags).toEqual([]);
    expect(md.reactions).toBeNull();
    expect(md.comments).toBeNull();
    expect(md.reading_time_minutes).toBeNull();
  });

  it("metadata.tags propagates from tag_list", () => {
    const node = devtoArticleToNode(sampleArticle, "x", "thujikun");
    const md = node.metadata as Record<string, unknown>;
    expect(md.tags).toEqual(["mcp", "ai", "graph"]);
    expect(md.author_handle).toBe("thujikun");
    expect(md.source).toBe("devto");
  });
});

describe("parseDevto", () => {
  it("end-to-end: list + per-article body → ParseResult with content + authored edge", async () => {
    let call = 0;
    const fetcher = vi.fn().mockImplementation((url: string) => {
      call++;
      if (url.includes("?username=")) {
        // page=1 full → page=2 empty
        if (url.includes("page=1")) return fakeOk([sampleArticle]);
        return fakeOk([]);
      }
      // body
      return fakeOk({ body_markdown: "本文" });
    });
    const result = await parseDevto({ fetcher: fetcher as FetchFn });
    expect(result.source).toBe("devto");
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toHaveLength(1);
    const e = result.edges[0];
    expect(e.edge_type).toBe("authored");
    expect(e.tgt_id).toBe(deterministicId("devto", "555"));
    expect(call).toBe(2); // list 1 page (only 1 article < per_page) + 1 body fetch
  });

  it("uses default dev.to username when not provided", async () => {
    const fetcher = vi.fn().mockReturnValue(fakeOk([]));
    await parseDevto({ fetcher: fetcher as FetchFn });
    expect(fetcher.mock.calls[0][0]).toContain("username=ryosuke_tsuji_f08e20fdca1");
  });
});
