/**
 * pipeline composer (syndicateForZenn / syndicateForDevto) の統合テスト。
 *
 * 個別 transform (link rewriter / footer / frontmatter builder) は単体 test 済なので、
 * ここでは「compose した時に順序と output shape が期待通り」を確認する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business pipeline composer の統合 test。link rewrite + footer append + frontmatter build が target 別に正しい順で適用され、Zenn は完成 markdown 文字列、dev.to は API attribute object を返すことを保証
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";
import type { Frontmatter } from "@self/content";

import { AI_DISCLOSURE_MARKDOWN } from "./devto-ai-disclosure.js";
import { syndicateForDevto, syndicateForZenn } from "./pipeline.js";

const meta: Frontmatter = {
  title: "DB Graph",
  publishedAt: "2026-05-01",
  tags: ["ai", "mcp"],
  syndication: {},
  excludeFromSyndication: false,
  summary: "summary",
};

const resolver = (slug: string): string | null => {
  if (slug === "other-post") return "https://zenn.dev/aircloset/articles/abc";
  return null;
};

describe("syndicateForZenn", () => {
  it("frontmatter + link 書き換え + footer append を順に適用", () => {
    const out = syndicateForZenn({
      meta,
      body: "前回の [Other](/posts/other-post) を参照。\n",
      resolver,
      canonicalHost: "https://ryantsuji.dev",
      enUrl: null,
      footerMarkdown: "---\n採用中。",
      emoji: "📊",
      publicationName: "aircloset",
    });
    // frontmatter (---で挟む)
    expect(out.startsWith("---\n")).toBe(true);
    expect(out).toContain('title: "DB Graph"');
    expect(out).toContain('emoji: "📊"');
    expect(out).toContain('publication_name: "aircloset"');
    // 内部 link 書き換え済
    expect(out).toContain("https://zenn.dev/aircloset/articles/abc");
    expect(out).not.toContain("/posts/other-post");
    // footer 末尾に
    expect(out.trim().endsWith("採用中。")).toBe(true);
  });

  it("footerMarkdown=null は footer を付けない", () => {
    const out = syndicateForZenn({
      meta,
      body: "本文。",
      resolver,
      canonicalHost: "https://ryantsuji.dev",
      enUrl: null,
      footerMarkdown: null,
    });
    expect(out).not.toContain("採用中");
    expect(out.trim().endsWith("本文。")).toBe(true);
  });

  it("publicationName=null で個人 publish (publication_name 行を omit)", () => {
    const out = syndicateForZenn({
      meta,
      body: "x",
      resolver,
      canonicalHost: "https://ryantsuji.dev",
      enUrl: null,
      footerMarkdown: null,
      publicationName: null,
    });
    expect(out).not.toContain("publication_name");
  });

  it("`/images/...` を canonicalHost 経由の絶対 URL に書き換える", () => {
    const out = syndicateForZenn({
      meta,
      body: "![alt](/images/posts/db-graph-mcp/a.png)\n",
      resolver,
      canonicalHost: "https://ryantsuji.dev",
      enUrl: null,
      footerMarkdown: null,
    });
    expect(out).toContain("![alt](https://ryantsuji.dev/images/posts/db-graph-mcp/a.png)");
    expect(out).not.toMatch(/\]\(\/images\//);
  });

  it("enUrl が指定された場合 :::message header を body 冒頭に prepend する", () => {
    const out = syndicateForZenn({
      meta,
      body: "みなさまこんにちは！\n\n本文。",
      resolver,
      canonicalHost: "https://ryantsuji.dev",
      enUrl: "https://ryantsuji.dev/posts/db-graph?lang=en",
      footerMarkdown: null,
    });
    // header が frontmatter の直後、本文より前に出る
    const bodyStart = out.indexOf(":::message");
    const greetingPos = out.indexOf("みなさまこんにちは");
    expect(bodyStart).toBeGreaterThan(0);
    expect(greetingPos).toBeGreaterThan(bodyStart);
    expect(out).toContain(
      "[English Version is here](https://ryantsuji.dev/posts/db-graph?lang=en)",
    );
  });

  it("enUrl=null では :::message header を inject しない", () => {
    const out = syndicateForZenn({
      meta,
      body: "本文。",
      resolver,
      canonicalHost: "https://ryantsuji.dev",
      enUrl: null,
      footerMarkdown: null,
    });
    expect(out).not.toContain(":::message");
    expect(out).not.toContain("English Version is here");
  });

  it("now を forward して publishAt 境界判定を builder まで通す (publishAt 未来 → 非公開)", () => {
    // Arrange: zenn 側で publishAt を未来に置き、now をその直前に freeze
    const future: Frontmatter = {
      ...meta,
      syndication: { zenn: { id: "z1", publishAt: "2099-01-01T00:00:00Z" } },
    };

    // Act
    const out = syndicateForZenn({
      meta: future,
      body: "x",
      resolver,
      canonicalHost: "https://ryantsuji.dev",
      enUrl: null,
      footerMarkdown: null,
      now: new Date("2026-05-18T00:00:00Z"),
    });

    // Assert: now が builder まで forward され published: false で出る
    expect(out).toContain("published: false");
  });

  it("now を forward して publishAt 過去なら published: true", () => {
    const past: Frontmatter = {
      ...meta,
      syndication: { zenn: { id: "z1", publishAt: "2020-01-01T00:00:00Z" } },
    };
    const out = syndicateForZenn({
      meta: past,
      body: "x",
      resolver,
      canonicalHost: "https://ryantsuji.dev",
      enUrl: null,
      footerMarkdown: null,
      now: new Date("2026-05-18T00:00:00Z"),
    });
    expect(out).toContain("published: true");
  });
});

describe("syndicateForDevto", () => {
  it("link 書き換え後の body を含めた article attribute を返す", () => {
    const out = syndicateForDevto({
      meta,
      body: "see [other](/posts/other-post)",
      slug: "db-graph",
      resolver,
      canonicalHost: "https://ryantsuji.dev",
    });
    expect(out.title).toBe("DB Graph");
    expect(out.published).toBe(true);
    expect(out.body_markdown).toContain("https://zenn.dev/aircloset/articles/abc");
    expect(out.body_markdown).not.toContain("/posts/other-post");
    expect(out.canonical_url).toBe("https://ryantsuji.dev/posts/db-graph");
    expect(out.tags).toStrictEqual(["ai", "mcp"]);
    expect(out.description).toBe("summary");
  });

  it("cover / series option を attribute に反映", () => {
    const out = syndicateForDevto({
      meta,
      body: "x",
      slug: "db-graph",
      resolver,
      canonicalHost: "https://ryantsuji.dev",
      coverImageUrl: "https://ryantsuji.dev/images/posts/db-graph.cover.png",
      series: "ai-harness",
    });
    expect(out.cover_image).toBe("https://ryantsuji.dev/images/posts/db-graph.cover.png");
    expect(out.series).toBe("ai-harness");
  });

  it("`/images/...` を canonicalHost 経由の絶対 URL に書き換える", () => {
    const out = syndicateForDevto({
      meta,
      body: "![alt](/images/posts/db-graph/a.png)\n",
      slug: "db-graph",
      resolver,
      canonicalHost: "https://ryantsuji.dev",
    });
    expect(out.body_markdown).toContain(
      "![alt](https://ryantsuji.dev/images/posts/db-graph/a.png)",
    );
    expect(out.body_markdown).not.toMatch(/\]\(\/images\//);
  });

  it("now を forward して publishAt 境界判定を builder まで通す (publishAt 未来 → published: false)", () => {
    const future: Frontmatter = {
      ...meta,
      syndication: { devto: { id: 1, slug: "x", publishAt: "2099-01-01T00:00:00Z" } },
    };
    const out = syndicateForDevto({
      meta: future,
      body: "x",
      slug: "db-graph",
      resolver,
      canonicalHost: "https://ryantsuji.dev",
      now: new Date("2026-05-18T00:00:00Z"),
    });
    expect(out.published).toBe(false);
  });

  it("now を forward して publishAt 過去なら published: true", () => {
    const past: Frontmatter = {
      ...meta,
      syndication: { devto: { id: 1, slug: "x", publishAt: "2020-01-01T00:00:00Z" } },
    };
    const out = syndicateForDevto({
      meta: past,
      body: "x",
      slug: "db-graph",
      resolver,
      canonicalHost: "https://ryantsuji.dev",
      now: new Date("2026-05-18T00:00:00Z"),
    });
    expect(out.published).toBe(true);
  });

  it("AI disclosure を body 先頭に自動 prepend する (dev.to community guideline 追従)", () => {
    const out = syndicateForDevto({
      meta,
      body: "Hi, I'm Ryan...\n\nbody.",
      slug: "db-graph",
      resolver,
      canonicalHost: "https://ryantsuji.dev",
    });
    expect(out.body_markdown.startsWith(AI_DISCLOSURE_MARKDOWN)).toBe(true);
    // 「Hi, I'm Ryan」が disclosure の後ろに来ていること
    expect(out.body_markdown.indexOf("Hi, I'm Ryan")).toBeGreaterThan(
      AI_DISCLOSURE_MARKDOWN.length,
    );
  });

  it("既に disclosure marker を含む SoT body には二重 prepend しない", () => {
    const body = `${AI_DISCLOSURE_MARKDOWN}\n\nHi.`;
    const out = syndicateForDevto({
      meta,
      body,
      slug: "db-graph",
      resolver,
      canonicalHost: "https://ryantsuji.dev",
    });
    // marker は 1 回しか出現しない
    const markerCount = out.body_markdown.split("<!-- ai-disclosure -->").length - 1;
    expect(markerCount).toBe(1);
  });
});

describe("syndicateForZenn (AI disclosure invariant)", () => {
  it("Zenn 配信には AI disclosure を入れない (Zenn は disclosure 必須ルール無し)", () => {
    const out = syndicateForZenn({
      meta,
      body: "本文。",
      resolver,
      canonicalHost: "https://ryantsuji.dev",
      enUrl: null,
      footerMarkdown: null,
    });
    expect(out).not.toContain("<!-- ai-disclosure -->");
    expect(out).not.toContain("AI assistance disclosure");
  });
});
