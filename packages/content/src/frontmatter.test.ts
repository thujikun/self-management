/**
 * Frontmatter Zod schema の境界値テスト。
 *
 * 必須 field の欠落 / 不正 ISO 日付 / tags の正規化 (重複削除 + 小文字化 + sort) を
 * 網羅。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business frontmatter parser の境界条件 test。必須 field の缺落で throw、tags 正規化、default 値、ISO date 日付の prefix 判定をユニット level で網羅する
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import { parseFrontmatter } from "./frontmatter.js";

describe("parseFrontmatter", () => {
  it("最小 input (title + publishedAt) で default 値を埋める", () => {
    expect(parseFrontmatter({ title: "hello", publishedAt: "2026-05-08" })).toStrictEqual({
      title: "hello",
      publishedAt: "2026-05-08",
      tags: [],
      draft: false,
    });
  });

  it("slug / lang を input に渡しても schema が strip して結果に含めない (filename authoritative)", () => {
    expect(
      parseFrontmatter({
        title: "x",
        publishedAt: "2026-05-08",
        slug: "ignored-slug",
        lang: "en",
      }),
    ).toStrictEqual({
      title: "x",
      publishedAt: "2026-05-08",
      tags: [],
      draft: false,
    });
  });

  it("title 欠落で throw", () => {
    expect(() => parseFrontmatter({ publishedAt: "2026-05-08" })).toThrow();
  });

  it("publishedAt が ISO date prefix 形式でないと throw", () => {
    expect(() => parseFrontmatter({ title: "x", publishedAt: "May 8, 2026" })).toThrow();
  });

  it("tags は重複削除 + 小文字化 + sort", () => {
    const out = parseFrontmatter({
      title: "x",
      publishedAt: "2026-05-08",
      tags: ["TypeScript", "react", "TYPESCRIPT", "RSC"],
    });
    expect(out.tags).toStrictEqual(["react", "rsc", "typescript"]);
  });

  it("canonical URL は URL 形式必須", () => {
    expect(() =>
      parseFrontmatter({ title: "x", publishedAt: "2026-05-08", canonical: "not-a-url" }),
    ).toThrow();
    expect(
      parseFrontmatter({
        title: "x",
        publishedAt: "2026-05-08",
        canonical: "https://zenn.dev/thujikun/articles/abc",
      }).canonical,
    ).toMatch(/^https:\/\//);
  });
});
