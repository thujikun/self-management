/**
 * `zenn.ts` の unit test (fake fetch、fixture-based)。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business fetchZennArticles / fetchZennBody / zennArticleToNode / parseZenn
 * の純粋ロジックを fake fetch で網羅。pagination / null body fallback / authored edge を検証
 * @graph-connects none
 */

import { describe, expect, it, vi } from "vitest";
import { deterministicId } from "../common/id.js";
import { SELF_PERSON_ID } from "./threads.js";
import {
  buildZennUrl,
  defaultFetcher,
  defaultZennUsername,
  emojiPrefixedTitle,
  fetchZennArticles,
  fetchZennBody,
  parseZenn,
  trimBody,
  zennArticleToNode,
  type FetchFn,
  type ZennListArticle,
} from "./zenn.js";

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

const sampleArticle: ZennListArticle = {
  id: 12345,
  title: "DB Graph MCP",
  slug: "db-graph-mcp",
  emoji: "🚀",
  article_type: "tech",
  published_at: "2026-05-04T10:00:00.000Z",
  body_letters_count: 5000,
  liked_count: 42,
  path: "/thujikun/articles/db-graph-mcp",
};

describe("defaultFetcher", () => {
  it("returns globalThis.fetch as FetchFn", () => {
    expect(typeof defaultFetcher()).toBe("function");
  });
});

describe("buildZennUrl", () => {
  it("prepends ZENN_API_BASE to path", () => {
    expect(buildZennUrl("/u/articles/x")).toBe("https://zenn.dev/u/articles/x");
  });
});

describe("defaultZennUsername", () => {
  it("returns 'thujikun'", () => {
    expect(defaultZennUsername()).toBe("thujikun");
  });
});

describe("trimBody", () => {
  it("collapses whitespace and trims", () => {
    expect(trimBody("  hello\n\nworld  ")).toBe("hello world");
  });
});

describe("emojiPrefixedTitle", () => {
  it("emoji あり: '🚀 t' を返す", () => {
    expect(emojiPrefixedTitle({ ...sampleArticle, title: "t", emoji: "🚀" })).toBe("🚀 t");
  });
  it("emoji なし: title のみ", () => {
    expect(emojiPrefixedTitle({ ...sampleArticle, title: "t", emoji: null })).toBe("t");
  });
});

describe("fetchZennArticles", () => {
  it("paginates via next_page until null and returns flat list", async () => {
    const pages = [
      { articles: [{ ...sampleArticle, id: 1 }], next_page: 2 },
      { articles: [{ ...sampleArticle, id: 2 }], next_page: null },
    ];
    let i = 0;
    const fetcher = vi.fn().mockImplementation(() => fakeOk(pages[i++]));
    const out = await fetchZennArticles("thujikun", fetcher as FetchFn);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe(1);
    expect(out[1].id).toBe(2);
    expect(fetcher.mock.calls[0][0]).toContain("page=1");
    expect(fetcher.mock.calls[1][0]).toContain("page=2");
  });

  it("URL-encodes the username", async () => {
    const fetcher = vi.fn().mockReturnValue(fakeOk({ articles: [], next_page: null }));
    await fetchZennArticles("user/with slash", fetcher as FetchFn);
    expect(fetcher.mock.calls[0][0]).toContain("username=user%2Fwith%20slash");
  });

  it("throws on non-2xx with status + body excerpt", async () => {
    const fetcher = vi.fn().mockReturnValue(fakeErr(503, "service down"));
    await expect(fetchZennArticles("thujikun", fetcher as FetchFn)).rejects.toThrow(
      /503.*service down/,
    );
  });

  it("handles missing articles field as empty list", async () => {
    const fetcher = vi.fn().mockReturnValue(fakeOk({ next_page: null }));
    expect(await fetchZennArticles("thujikun", fetcher as FetchFn)).toEqual([]);
  });
});

describe("fetchZennBody", () => {
  it("returns body markdown when API responds OK", async () => {
    const fetcher = vi.fn().mockReturnValue(fakeOk({ article: { body: "# title\n本文" } }));
    expect(await fetchZennBody("thujikun", "slug", fetcher as FetchFn)).toBe("# title\n本文");
  });

  it("falls back to body_html when body is missing", async () => {
    const fetcher = vi.fn().mockReturnValue(fakeOk({ article: { body_html: "<p>html</p>" } }));
    expect(await fetchZennBody("thujikun", "slug", fetcher as FetchFn)).toBe("<p>html</p>");
  });

  it("returns empty string on non-ok response", async () => {
    const fetcher = vi.fn().mockReturnValue(fakeErr(404, "not found"));
    expect(await fetchZennBody("thujikun", "slug", fetcher as FetchFn)).toBe("");
  });

  it("returns empty string when article field missing", async () => {
    const fetcher = vi.fn().mockReturnValue(fakeOk({}));
    expect(await fetchZennBody("thujikun", "slug", fetcher as FetchFn)).toBe("");
  });

  it("returns empty string when both body and body_html are absent", async () => {
    const fetcher = vi.fn().mockReturnValue(fakeOk({ article: { body_letters_count: 100 } }));
    expect(await fetchZennBody("thujikun", "slug", fetcher as FetchFn)).toBe("");
  });
});

describe("zennArticleToNode", () => {
  it("builds correct content node fields with deterministic id", () => {
    const node = zennArticleToNode(sampleArticle, "本文 content", "thujikun");
    expect(node.kind).toBe("contents");
    expect(node.id).toBe(deterministicId("zenn", "12345"));
    expect(node.fields.content_id).toBe(node.id);
    expect(node.fields.source).toBe("zenn");
    expect(node.fields.url).toBe("https://zenn.dev/thujikun/articles/db-graph-mcp");
    expect(node.fields.author_person_id).toBe(SELF_PERSON_ID);
    expect(node.fields.body_md).toBe("本文 content");
    expect(node.fields.published_at).toBe("2026-05-04T10:00:00.000Z");
  });

  it("body_summary は emoji + title + 本文冒頭 500 字を含む", () => {
    const long = "a".repeat(700);
    const node = zennArticleToNode(sampleArticle, long, "thujikun");
    const s = node.body_summary as string;
    expect(s).toContain("🚀 DB Graph MCP");
    // 500 字 cap
    const after = s.split("\n\n")[1];
    expect(after.length).toBeLessThanOrEqual(500);
  });

  it("emoji なしでも title only で組み立てる", () => {
    const node = zennArticleToNode({ ...sampleArticle, emoji: null }, "x", "thujikun");
    const s = node.body_summary as string;
    expect(s.split("\n\n")[0]).toBe("DB Graph MCP");
  });

  it("metadata に slug / liked_count / author_handle を入れる", () => {
    const node = zennArticleToNode(sampleArticle, "x", "thujikun");
    const md = node.metadata as Record<string, unknown>;
    expect(md.slug).toBe("db-graph-mcp");
    expect(md.liked_count).toBe(42);
    expect(md.author_handle).toBe("thujikun");
    expect(md.source).toBe("zenn");
  });

  it("metadata の article_type / liked_count / body_letters_count を null に fallback (省略時)", () => {
    const minimal: ZennListArticle = {
      id: 99,
      title: "minimal",
      slug: "min",
      published_at: "2026-01-01T00:00:00Z",
      path: "/u/articles/min",
    };
    const node = zennArticleToNode(minimal, "", "thujikun");
    const md = node.metadata as Record<string, unknown>;
    expect(md.article_type).toBeNull();
    expect(md.liked_count).toBeNull();
    expect(md.body_letters_count).toBeNull();
    expect(md.emoji).toBeNull();
  });
});

describe("parseZenn", () => {
  it("end-to-end: list + per-article body → ParseResult with content + authored edge", async () => {
    let call = 0;
    const fetcher = vi.fn().mockImplementation((url: string) => {
      call++;
      if (url.includes("/api/articles?username=")) {
        return fakeOk({ articles: [sampleArticle], next_page: null });
      }
      // 個別記事 body
      return fakeOk({ article: { body: "本文" } });
    });
    const result = await parseZenn({ fetcher: fetcher as FetchFn });
    expect(result.source).toBe("zenn");
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toHaveLength(1);
    const e = result.edges[0];
    expect(e.edge_type).toBe("authored");
    expect(e.src_kind).toBe("persons");
    expect(e.src_id).toBe(SELF_PERSON_ID);
    expect(e.tgt_kind).toBe("contents");
    expect(e.tgt_id).toBe(deterministicId("zenn", "12345"));
    // 2 calls: list + per-article body
    expect(call).toBe(2);
  });

  it("uses default username 'thujikun' when not provided", async () => {
    const fetcher = vi.fn().mockReturnValue(fakeOk({ articles: [], next_page: null }));
    await parseZenn({ fetcher: fetcher as FetchFn });
    expect(fetcher.mock.calls[0][0]).toContain("username=thujikun");
  });
});
