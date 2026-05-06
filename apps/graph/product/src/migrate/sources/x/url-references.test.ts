/**
 * `url-references.ts` の unit test (pure 関数の純粋ロジック検証)。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business normalizeUrl / extractUrls / buildUrlIndex / buildUrlReferenceEdges
 * の網羅。trailing 句読点 strip、case 正規化、self-ref / dedupe / X 限定 src の挙動
 * @graph-connects none
 */

import { describe, expect, it, vi } from "vitest";
import type { NodeInput } from "../common/types.js";
import {
  buildUrlIndex,
  buildUrlReferenceEdges,
  collectTcoUrls,
  defaultBqClient,
  extractUrls,
  loadUrlIndexFromBq,
  normalizeUrl,
  resolveTcoUrls,
  type BqQueryClient,
  type HttpHeadFn,
} from "./url-references.js";

describe("normalizeUrl", () => {
  it("strips trailing slash and lowercases", () => {
    expect(normalizeUrl("https://Dev.to/u/Article/")).toBe("https://dev.to/u/article");
  });

  it("drops query string and fragment", () => {
    expect(normalizeUrl("https://zenn.dev/u/articles/x?source=tw#section")).toBe(
      "https://zenn.dev/u/articles/x",
    );
  });

  it("trims trailing punctuation", () => {
    expect(normalizeUrl("https://zenn.dev/u/articles/x.")).toBe("https://zenn.dev/u/articles/x");
    expect(normalizeUrl("https://zenn.dev/u/articles/x,")).toBe("https://zenn.dev/u/articles/x");
  });

  it("returns lowercased input on parse failure", () => {
    expect(normalizeUrl("not a url")).toBe("not a url");
  });
});

describe("extractUrls", () => {
  it("extracts http and https URLs from mixed text", () => {
    const t =
      "check this https://dev.to/u/article and http://example.com/foo also https://zenn.dev/u/x.";
    expect(extractUrls(t)).toEqual([
      "https://dev.to/u/article",
      "http://example.com/foo",
      "https://zenn.dev/u/x",
    ]);
  });

  it("returns empty array when no URLs", () => {
    expect(extractUrls("just plain text")).toEqual([]);
  });

  it("strips trailing parenthesis from URLs", () => {
    expect(extractUrls("see (https://zenn.dev/u/x)")).toEqual(["https://zenn.dev/u/x"]);
  });
});

function content(id: string, source: string, url: string | null, body: string): NodeInput {
  return {
    kind: "contents",
    id,
    fields: { content_id: id, source, url, body_md: body },
  };
}

describe("buildUrlIndex", () => {
  it("indexes only contents nodes with non-null url, normalized", () => {
    const nodes: NodeInput[] = [
      content("c1", "zenn", "https://Zenn.dev/u/Articles/X/", "x"),
      content("c2", "x", null, "y"),
      { kind: "persons", id: "p1", fields: {} },
    ];
    const idx = buildUrlIndex(nodes);
    expect(idx.size).toBe(1);
    expect(idx.get("https://zenn.dev/u/articles/x")).toBe("c1");
  });
});

describe("buildUrlReferenceEdges", () => {
  it("creates references edge from X tweet to article when body URL matches index", () => {
    const article = content("article1", "zenn", "https://zenn.dev/u/articles/db-graph", "");
    const tweet = content(
      "tweet1",
      "x",
      "https://x.com/u/status/1",
      "DB Graph 公開しました! https://zenn.dev/u/articles/db-graph 参照",
    );
    const edges = buildUrlReferenceEdges([article, tweet]);
    expect(edges).toHaveLength(1);
    const e = edges[0];
    expect(e.edge_type).toBe("references");
    expect(e.src_id).toBe("tweet1");
    expect(e.tgt_id).toBe("article1");
    const props = e.properties as { via: string; url: string };
    expect(props.via).toBe("url_in_text");
  });

  it("skips when URL doesn't match any indexed content", () => {
    const tweet = content("tweet1", "x", null, "see https://example.com/random");
    expect(buildUrlReferenceEdges([tweet])).toEqual([]);
  });

  it("dedupes when same URL appears twice in body", () => {
    const article = content("a1", "devto", "https://dev.to/u/x", "");
    const tweet = content("t1", "x", null, "see https://dev.to/u/x and again https://dev.to/u/x");
    const edges = buildUrlReferenceEdges([article, tweet]);
    expect(edges).toHaveLength(1);
  });

  it("skips self-reference (URL points to the tweet itself)", () => {
    const tweet = content("t1", "x", "https://x.com/u/status/1", "see https://x.com/u/status/1");
    expect(buildUrlReferenceEdges([tweet])).toEqual([]);
  });

  it("only processes X-sourced contents as src (zenn → devto URL match should NOT create edge here)", () => {
    const zenn = content("z1", "zenn", "https://zenn.dev/u/x", "see https://dev.to/u/y");
    const devto = content("d1", "devto", "https://dev.to/u/y", "");
    expect(buildUrlReferenceEdges([zenn, devto])).toEqual([]);
  });

  it("ignores contents nodes with empty body_md", () => {
    const article = content("a1", "devto", "https://dev.to/u/x", "");
    const tweet = content("t1", "x", null, "");
    expect(buildUrlReferenceEdges([article, tweet])).toEqual([]);
  });

  it("ignores non-contents nodes", () => {
    const person: NodeInput = { kind: "persons", id: "p1", fields: { body_md: "https://x.com" } };
    expect(buildUrlReferenceEdges([person])).toEqual([]);
  });

  it("merges externalIndex (e.g. from BQ) with in-memory contents", () => {
    const tweet = content("t1", "x", null, "see https://dev.to/u/abc");
    const external = new Map([["https://dev.to/u/abc", "external-content-id"]]);
    const edges = buildUrlReferenceEdges([tweet], external);
    expect(edges).toHaveLength(1);
    expect(edges[0].tgt_id).toBe("external-content-id");
  });

  it("in-memory index takes precedence over externalIndex for same URL", () => {
    const article = content("local-a", "zenn", "https://zenn.dev/u/x", "");
    const tweet = content("t1", "x", null, "see https://zenn.dev/u/x");
    const external = new Map([["https://zenn.dev/u/x", "stale-id"]]);
    const edges = buildUrlReferenceEdges([article, tweet], external);
    expect(edges).toHaveLength(1);
    expect(edges[0].tgt_id).toBe("local-a");
  });
});

describe("defaultBqClient", () => {
  it("returns a BigQuery instance with createQueryJob", () => {
    expect(typeof defaultBqClient().createQueryJob).toBe("function");
  });
});

describe("resolveTcoUrls", () => {
  it("calls head() for unique t.co URLs only (skips non-t.co)", async () => {
    const head = vi.fn(async (url: string) => {
      if (url === "https://t.co/abc") return "https://dev.to/u/article";
      if (url === "https://t.co/def") return "https://zenn.dev/u/x";
      return url;
    });
    const map = await resolveTcoUrls(
      [
        "https://t.co/abc",
        "https://t.co/def",
        "https://t.co/abc", // duplicate
        "https://example.com/foo", // not t.co
      ],
      head as HttpHeadFn,
    );
    expect(head).toHaveBeenCalledTimes(2);
    expect(map.get("https://t.co/abc")).toBe("https://dev.to/u/article");
    expect(map.get("https://t.co/def")).toBe("https://zenn.dev/u/x");
  });

  it("ignores URLs that fail HEAD or return same URL", async () => {
    const head = vi.fn(async (url: string) => {
      if (url === "https://t.co/fail") throw new Error("network");
      if (url === "https://t.co/same") return "https://t.co/same";
      return "https://expanded";
    });
    const map = await resolveTcoUrls(
      ["https://t.co/fail", "https://t.co/same", "https://t.co/ok"],
      head as HttpHeadFn,
    );
    expect(map.size).toBe(1);
    expect(map.get("https://t.co/ok")).toBe("https://expanded");
  });
});

describe("collectTcoUrls", () => {
  it("gathers unique t.co URLs from X-source body_md", () => {
    const tweet1 = content("t1", "x", null, "see https://t.co/abc and https://t.co/abc");
    const tweet2 = content("t2", "x", null, "another https://t.co/def");
    const article = content("a1", "zenn", null, "see https://t.co/zzz"); // non-X, ignored
    expect(collectTcoUrls([tweet1, tweet2, article])).toEqual([
      "https://t.co/abc",
      "https://t.co/def",
    ]);
  });
});

describe("buildUrlReferenceEdges with tco resolution", () => {
  it("matches via expanded URL when raw URL is t.co", () => {
    const article = content("a1", "devto", "https://dev.to/u/article", "");
    const tweet = content("t1", "x", null, "公開しました https://t.co/abc");
    const tcoMap = new Map([["https://t.co/abc", "https://dev.to/u/article"]]);
    const edges = buildUrlReferenceEdges([article, tweet], undefined, tcoMap);
    expect(edges).toHaveLength(1);
    expect(edges[0].tgt_id).toBe("a1");
    const props = edges[0].properties as { url: string; tco?: string };
    expect(props.url).toBe("https://dev.to/u/article");
    expect(props.tco).toBe("https://t.co/abc");
  });

  it("falls back to raw URL match when tco map empty", () => {
    const article = content("a1", "devto", "https://dev.to/u/article", "");
    const tweet = content("t1", "x", null, "see https://dev.to/u/article");
    const edges = buildUrlReferenceEdges([article, tweet]);
    expect(edges).toHaveLength(1);
  });
});

describe("loadUrlIndexFromBq", () => {
  function makeMockClient(rows: Array<Record<string, unknown>>): BqQueryClient {
    return {
      createQueryJob: vi.fn(async () => [
        { getQueryResults: async () => [rows] },
      ] as Awaited<ReturnType<BqQueryClient["createQueryJob"]>>),
    };
  }

  it("returns normalized URL → content_id index from BQ rows", async () => {
    const client = makeMockClient([
      { url: "https://Zenn.dev/u/X/", content_id: "c1" },
      { url: "https://dev.to/u/y", content_id: "c2" },
    ]);
    const idx = await loadUrlIndexFromBq(client);
    expect(idx.size).toBe(2);
    expect(idx.get("https://zenn.dev/u/x")).toBe("c1");
    expect(idx.get("https://dev.to/u/y")).toBe("c2");
  });

  it("skips rows where url or content_id is not a string", async () => {
    const client = makeMockClient([
      { url: null, content_id: "c1" },
      { url: "https://x", content_id: null },
      { url: "https://valid", content_id: "c-valid" },
    ]);
    const idx = await loadUrlIndexFromBq(client);
    expect(idx.size).toBe(1);
    expect(idx.get("https://valid")).toBe("c-valid");
  });
});
