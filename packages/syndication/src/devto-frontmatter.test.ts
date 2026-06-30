/**
 * `buildDevtoArticle` の境界網羅。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business dev.to article builder の test。tags 4 件上限 / canonical_url 生成 / cover_image / series / publishAt → published / summary → description の各 path を網羅
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";
import type { Frontmatter } from "@self/content";

import { buildDevtoArticle, isPublishedNow } from "./devto-frontmatter.js";

const base: Frontmatter = {
  title: "Hello",
  publishedAt: "2026-05-01",
  tags: ["ai", "mcp"],
  syndication: {},
  excludeFromSyndication: false,
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
      coverImageUrl: "https://ryantsuji.dev/images/posts/x.cover.png",
      series: "ai-harness",
    });
    expect(out.cover_image).toBe("https://ryantsuji.dev/images/posts/x.cover.png");
    expect(out.series).toBe("ai-harness");
  });

  it("syndication.devto.publishAt が未来なら published: false (公開保留)", () => {
    const out = buildDevtoArticle(
      { ...base, syndication: { devto: { id: 123, slug: "x", publishAt: "2099-01-01" } } },
      "x",
      {
        canonicalHost: "https://ryantsuji.dev",
        slug: "x",
        now: new Date("2026-05-18T00:00:00Z"),
      },
    );
    expect(out.published).toBe(false);
  });

  it("syndication.devto.publishAt が過去なら published: true", () => {
    const out = buildDevtoArticle(
      { ...base, syndication: { devto: { id: 123, slug: "x", publishAt: "2020-01-01" } } },
      "x",
      {
        canonicalHost: "https://ryantsuji.dev",
        slug: "x",
        now: new Date("2026-05-18T00:00:00Z"),
      },
    );
    expect(out.published).toBe(true);
  });
});

describe("isPublishedNow", () => {
  const now = new Date("2026-05-18T00:00:00Z");
  it("publishAt 未指定なら常に true (公開可)", () => {
    expect(isPublishedNow(base, "devto", now)).toBe(true);
  });

  it("publishAt が未来なら false", () => {
    const meta: Frontmatter = {
      ...base,
      syndication: { devto: { id: 1, slug: "x", publishAt: "2099-01-01" } },
    };
    expect(isPublishedNow(meta, "devto", now)).toBe(false);
  });

  it("publishAt が過去・現在なら true", () => {
    const meta: Frontmatter = {
      ...base,
      syndication: { devto: { id: 1, slug: "x", publishAt: "2020-01-01" } },
    };
    expect(isPublishedNow(meta, "devto", now)).toBe(true);
  });

  it("publishAt が parse 不能なら fallback で true (= !draft)", () => {
    const meta: Frontmatter = {
      ...base,
      syndication: { devto: { id: 1, slug: "x", publishAt: "not-a-date" } },
    };
    expect(isPublishedNow(meta, "devto", now)).toBe(true);
  });

  it("target が違えば対象 publishAt は無視", () => {
    const meta: Frontmatter = {
      ...base,
      syndication: { zenn: { id: "x", publishAt: "2099-01-01" } },
    };
    // devto の publishAt は未設定 → true (公開可)
    expect(isPublishedNow(meta, "devto", now)).toBe(true);
    // zenn は未来 → false
    expect(isPublishedNow(meta, "zenn", now)).toBe(false);
  });
});
