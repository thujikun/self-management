/**
 * `buildZennFrontmatter` / `stringifyZennFrontmatter` の境界網羅。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business Zenn frontmatter builder の test。emoji / publication_name / topics 上限 5 件 / publishAt → published reverse / YAML escape を網羅
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";
import type { Frontmatter } from "@self/content";

import { isPublishedNow } from "./devto-frontmatter.js";
import { buildZennFrontmatter, stringifyZennFrontmatter } from "./zenn-frontmatter.js";

const base: Frontmatter = {
  title: "テスト記事",
  publishedAt: "2026-05-01",
  tags: ["ai", "mcp", "graphrag"],
  syndication: {},
  excludeFromSyndication: false,
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

  it("syndication.zenn.publishAt が未来なら published: false", () => {
    const out = buildZennFrontmatter(
      { ...base, syndication: { zenn: { id: "x", publishAt: "2099-01-01" } } },
      { now: new Date("2026-05-18T00:00:00Z") },
    );
    expect(out.published).toBe(false);
  });

  it("syndication.zenn.publishAt が過去なら published: true", () => {
    const out = buildZennFrontmatter(
      { ...base, syndication: { zenn: { id: "x", publishAt: "2020-01-01" } } },
      { now: new Date("2026-05-18T00:00:00Z") },
    );
    expect(out.published).toBe(true);
  });
});

describe("isPublishedNow(target=zenn)", () => {
  // `buildZennFrontmatter` の published 判定経路を、共通 helper `isPublishedNow` の
  // zenn target 版として freeze。zenn 専用 wrapper を廃止して devto 版と同一実装を
  // 共有するための回帰 test (`devto-frontmatter.ts:isPublishedNow` 側で同じ pure
  // 関数を呼ぶ).
  const now = new Date("2026-05-18T00:00:00Z");
  it("publishAt 未指定なら true (公開可)", () => {
    expect(isPublishedNow(base, "zenn", now)).toBe(true);
  });
  it("publishAt 未来 → false", () => {
    expect(
      isPublishedNow(
        { ...base, syndication: { zenn: { id: "x", publishAt: "2099-01-01" } } },
        "zenn",
        now,
      ),
    ).toBe(false);
  });
  it("publishAt 過去 → true", () => {
    expect(
      isPublishedNow(
        { ...base, syndication: { zenn: { id: "x", publishAt: "2020-01-01" } } },
        "zenn",
        now,
      ),
    ).toBe(true);
  });
  it("publishAt parse 不能 → true fallback", () => {
    expect(
      isPublishedNow(
        { ...base, syndication: { zenn: { id: "x", publishAt: "garbage" } } },
        "zenn",
        now,
      ),
    ).toBe(true);
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
