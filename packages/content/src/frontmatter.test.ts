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
        cover: "/images/posts/x.cover.png",
      }).cover,
    ).toBe("/images/posts/x.cover.png");
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

  it("syndication.zenn.publishAt / devto.publishAt を受理 (媒体ごとの遅延公開)", () => {
    const out = parseFrontmatter({
      title: "x",
      publishedAt: "2026-05-08",
      syndication: {
        zenn: { id: "abc", publishAt: "2026-05-19T10:00:00+09:00" },
        devto: { id: 1, slug: "y", publishAt: "2026-05-20" },
      },
    });
    expect(out.syndication.zenn?.publishAt).toBe("2026-05-19T10:00:00+09:00");
    expect(out.syndication.devto?.publishAt).toBe("2026-05-20");
  });

  it("publishAt 形式が不正 (YYYY-MM-DD で始まらない) なら throw", () => {
    expect(() =>
      parseFrontmatter({
        title: "x",
        publishedAt: "2026-05-08",
        syndication: { devto: { id: 1, slug: "y", publishAt: "tomorrow" } },
      }),
    ).toThrow();
  });

  it("devto を publishAt だけで指定可 (id/slug 未設定 = 未作成 post の予約) — id/slug は optional", () => {
    const out = parseFrontmatter({
      title: "x",
      publishedAt: "2026-05-26",
      syndication: { devto: { publishAt: "2026-05-26T07:00:00-07:00" } },
    });
    expect(out.syndication.devto?.id).toBeUndefined();
    expect(out.syndication.devto?.slug).toBeUndefined();
    expect(out.syndication.devto?.publishAt).toBe("2026-05-26T07:00:00-07:00");
  });

  it("zenn を publishAt だけで指定可 (id 未設定 = 未作成 post の予約) — id は optional", () => {
    const out = parseFrontmatter({
      title: "x",
      publishedAt: "2026-05-26",
      syndication: { zenn: { publishAt: "2026-05-26T08:30:00+09:00" } },
    });
    expect(out.syndication.zenn?.id).toBeUndefined();
    expect(out.syndication.zenn?.publishAt).toBe("2026-05-26T08:30:00+09:00");
  });

  it("series + seriesOrder=1 が parse される", () => {
    const m = parseFrontmatter({
      title: "x",
      publishedAt: "2026-05-08",
      series: "building-ai-harness",
      seriesOrder: 1,
    });
    expect(m.series).toBe("building-ai-harness");
    expect(m.seriesOrder).toBe(1);
  });

  it("series 未指定でも parse 成功 (optional)", () => {
    const m = parseFrontmatter({ title: "x", publishedAt: "2026-05-08" });
    expect(m.series).toBeUndefined();
    expect(m.seriesOrder).toBeUndefined();
  });

  it("series='' (min 1 違反) は throw", () => {
    expect(() => parseFrontmatter({ title: "x", publishedAt: "2026-05-08", series: "" })).toThrow();
  });

  it("emoji を指定すれば文字列として parse され、未指定なら undefined のまま (default 不付与)", () => {
    expect(
      parseFrontmatter({ title: "x", publishedAt: "2026-05-08", emoji: "📊" }).emoji,
    ).toStrictEqual("📊");
    expect(parseFrontmatter({ title: "x", publishedAt: "2026-05-08" }).emoji).toBeUndefined();
  });

  it("emoji=42 (非文字列) は throw", () => {
    expect(() => parseFrontmatter({ title: "x", publishedAt: "2026-05-08", emoji: 42 })).toThrow();
  });

  it("seriesOrder=0 / 負値 / 小数 (int positive 違反) は throw", () => {
    for (const bad of [0, -1, 1.5]) {
      expect(() =>
        parseFrontmatter({
          title: "x",
          publishedAt: "2026-05-08",
          seriesOrder: bad,
        }),
      ).toThrow();
    }
  });
});
