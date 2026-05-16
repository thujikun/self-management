/**
 * `buildZennFrontmatter` / `stringifyZennFrontmatter` の境界網羅。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business Zenn frontmatter builder の test。emoji / publication_name / topics 上限 5 件 / draft → published reverse / YAML escape を網羅
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";
import type { Frontmatter } from "@self/content";

import { buildZennFrontmatter, stringifyZennFrontmatter } from "./zenn-frontmatter.js";

const base: Frontmatter = {
  title: "テスト記事",
  publishedAt: "2026-05-01",
  tags: ["ai", "mcp", "graphrag"],
  draft: false,
  syndication: {},
};

describe("buildZennFrontmatter", () => {
  it("default option: emoji=🤖 / type=tech / publication_name=aircloset", () => {
    const out = buildZennFrontmatter(base);
    expect(out).toStrictEqual({
      title: "テスト記事",
      emoji: "🤖",
      type: "tech",
      topics: ["ai", "mcp", "graphrag"],
      published: true,
      publication_name: "aircloset",
    });
  });

  it("emoji / publicationName option で上書き", () => {
    const out = buildZennFrontmatter(base, { emoji: "📊", publicationName: "myorg" });
    expect(out.emoji).toBe("📊");
    expect(out.publication_name).toBe("myorg");
  });

  it("publicationName=null で publication_name 自体を omit (個人 publish)", () => {
    const out = buildZennFrontmatter(base, { publicationName: null });
    expect(out.publication_name).toBeUndefined();
  });

  it("draft: true → published: false に反転", () => {
    const out = buildZennFrontmatter({ ...base, draft: true });
    expect(out.published).toBe(false);
  });

  it("tags が 5 件超なら先頭 5 件に truncate (Zenn topics 上限)", () => {
    const out = buildZennFrontmatter({
      ...base,
      tags: ["a", "b", "c", "d", "e", "f", "g"],
    });
    expect(out.topics).toStrictEqual(["a", "b", "c", "d", "e"]);
  });

  it("tags 空配列なら topics も空", () => {
    expect(buildZennFrontmatter({ ...base, tags: [] }).topics).toStrictEqual([]);
  });
});

describe("stringifyZennFrontmatter", () => {
  it("`---` で挟まれた YAML 文字列を生成、行順は title / emoji / type / topics / published / publication_name", () => {
    const out = stringifyZennFrontmatter({
      title: "x",
      emoji: "🤖",
      type: "tech",
      topics: ["a", "b"],
      published: true,
      publication_name: "aircloset",
    });
    const lines = out.split("\n");
    expect(lines[0]).toBe("---");
    expect(lines).toContain('title: "x"');
    expect(lines).toContain('emoji: "🤖"');
    expect(lines).toContain("type: tech");
    expect(lines).toContain('topics: ["a", "b"]');
    expect(lines).toContain("published: true");
    expect(lines).toContain('publication_name: "aircloset"');
    expect(lines[lines.length - 1]).toBe("---");
  });

  it("publication_name 無しなら該行を omit", () => {
    const out = stringifyZennFrontmatter({
      title: "x",
      emoji: "🤖",
      type: "tech",
      topics: [],
      published: true,
    });
    expect(out).not.toContain("publication_name");
  });

  it('title 内の `"` / backslash を escape', () => {
    const out = stringifyZennFrontmatter({
      title: 'foo "bar" \\baz',
      emoji: "🤖",
      type: "tech",
      topics: [],
      published: true,
    });
    expect(out).toContain('title: "foo \\"bar\\" \\\\baz"');
  });
});
