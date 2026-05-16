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
      syndication: {},
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
      syndication: {},
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

  it("cover は `/` 始まりの絶対 path のみ受理 (相対 path は reject)", () => {
    expect(() =>
      parseFrontmatter({
        title: "x",
        publishedAt: "2026-05-08",
        cover: "posts/x.cover.png",
      }),
    ).toThrow();
    expect(
      parseFrontmatter({
        title: "x",
        publishedAt: "2026-05-08",
        cover: "/posts/x.cover.png",
      }).cover,
    ).toBe("/posts/x.cover.png");
  });

  it("syndication.zenn.id / devto.id+slug の組合せを受理", () => {
    const out = parseFrontmatter({
      title: "x",
      publishedAt: "2026-05-08",
      syndication: {
        zenn: { id: "d9fc317c1336c2" },
        devto: { id: 3655760, slug: "we-built-17-mcp-servers-3lk2" },
      },
    });
    expect(out.syndication.zenn?.id).toBe("d9fc317c1336c2");
    expect(out.syndication.devto?.id).toBe(3655760);
    expect(out.syndication.devto?.slug).toBe("we-built-17-mcp-servers-3lk2");
  });

  it("syndication.devto.id は正の整数のみ (0 / 負数 / 文字列で throw)", () => {
    for (const bad of [0, -1, "3655760"]) {
      expect(() =>
        parseFrontmatter({
          title: "x",
          publishedAt: "2026-05-08",
          syndication: { devto: { id: bad, slug: "y" } },
        }),
      ).toThrow();
    }
  });

  it("syndication 部分指定 (zenn だけ / devto だけ) も受理", () => {
    const only_zenn = parseFrontmatter({
      title: "x",
      publishedAt: "2026-05-08",
      syndication: { zenn: { id: "abc" } },
    });
    expect(only_zenn.syndication.zenn?.id).toBe("abc");
    expect(only_zenn.syndication.devto).toBeUndefined();
  });
});
