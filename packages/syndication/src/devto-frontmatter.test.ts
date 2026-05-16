/**
 * `buildDevtoArticle` の境界網羅。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business dev.to article builder の test。tags 4 件上限 / canonical_url 生成 / cover_image / series / draft → published / summary → description の各 path を網羅
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";
import type { Frontmatter } from "@self/content";

import { buildDevtoArticle } from "./devto-frontmatter.js";

const base: Frontmatter = {
  title: "Hello",
  publishedAt: "2026-05-01",
  tags: ["ai", "mcp"],
  draft: false,
  syndication: {},
  summary: "summary text",
};

describe("buildDevtoArticle", () => {
  it("最小構成: title / published / body_markdown / tags / canonical_url が埋まる", () => {
    const out = buildDevtoArticle(base, "# body", {
      canonicalHost: "https://ryantsuji.dev",
      slug: "hello",
    });
    expect(out).toStrictEqual({
      title: "Hello",
      published: true,
      body_markdown: "# body",
      tags: ["ai", "mcp"],
      canonical_url: "https://ryantsuji.dev/posts/hello",
      description: "summary text",
    });
  });

  it("tags が 4 件超なら先頭 4 件に truncate", () => {
    const out = buildDevtoArticle({ ...base, tags: ["a", "b", "c", "d", "e", "f"] }, "x", {
      canonicalHost: "https://ryantsuji.dev",
      slug: "x",
    });
    expect(out.tags).toStrictEqual(["a", "b", "c", "d"]);
  });

  it("canonicalHost の trailing slash を除いて canonical_url 構築", () => {
    const out = buildDevtoArticle(base, "x", {
      canonicalHost: "https://ryantsuji.dev/",
      slug: "hello",
    });
    expect(out.canonical_url).toBe("https://ryantsuji.dev/posts/hello");
  });

  it("draft: true → published: false", () => {
    const out = buildDevtoArticle({ ...base, draft: true }, "x", {
      canonicalHost: "https://ryantsuji.dev",
      slug: "x",
    });
    expect(out.published).toBe(false);
  });

  it("summary 無しなら description omit", () => {
    const out = buildDevtoArticle({ ...base, summary: undefined }, "x", {
      canonicalHost: "https://ryantsuji.dev",
      slug: "x",
    });
    expect(out.description).toBeUndefined();
  });

  it("coverImageUrl + series option を反映", () => {
    const out = buildDevtoArticle(base, "x", {
      canonicalHost: "https://ryantsuji.dev",
      slug: "x",
      coverImageUrl: "https://ryantsuji.dev/posts/x.cover.png",
      series: "ai-harness",
    });
    expect(out.cover_image).toBe("https://ryantsuji.dev/posts/x.cover.png");
    expect(out.series).toBe("ai-harness");
  });
});
