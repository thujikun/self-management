/**
 * Atom feed builder のテスト。pure 関数なので I/O 無し、PostListItem fixture を
 * 直接渡して生成 XML の構造を検証する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business Atom feed builder の unit test。escapeXml の全予約文字、日付 normalize、最新 updatedAt 抽出、entry の URL に lang query が付くか、tags / summary の optional 分岐を網羅
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import type { PostListItem } from "./posts.js";
import { buildAtomFeed, escapeXml, latestUpdatedAt, toRfc3339 } from "./rss.js";

function makePost(
  over: Partial<PostListItem> & Pick<PostListItem, "slug" | "title" | "publishedAt">,
): PostListItem {
  return {
    title: over.title,
    publishedAt: over.publishedAt,
    tags: over.tags ?? [],
    draft: false,
    syndication: {},
    slug: over.slug,
    lang: over.lang ?? "en",
    availableLangs: over.availableLangs ?? ["en"],
    servedLang: over.servedLang ?? "en",
    summary: over.summary,
    updatedAt: over.updatedAt,
    canonical: over.canonical,
    cover: over.cover,
  } as PostListItem;
}

describe("escapeXml", () => {
  it("予約 5 文字 (< > & \" ') を実体参照に", () => {
    expect(escapeXml("<a href=\"x\">'&'</a>")).toBe(
      "&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;",
    );
  });

  it("& を最初に escape して二重 escape を回避", () => {
    expect(escapeXml("&amp;")).toBe("&amp;amp;");
  });

  it("通常文字はそのまま", () => {
    expect(escapeXml("hello world 日本語")).toBe("hello world 日本語");
  });
});

describe("toRfc3339", () => {
  it("YYYY-MM-DD を midnight UTC RFC 3339 に", () => {
    expect(toRfc3339("2026-05-16")).toBe("2026-05-16T00:00:00Z");
  });

  it("既に time portion が付いた string でも YYYY-MM-DD 部分のみ採用", () => {
    expect(toRfc3339("2026-05-16T12:34:56+09:00")).toBe("2026-05-16T00:00:00Z");
  });
});

describe("latestUpdatedAt", () => {
  it("post 0 件なら epoch 開始日", () => {
    expect(latestUpdatedAt([])).toBe("1970-01-01T00:00:00Z");
  });

  it("updatedAt が無い post は publishedAt を採用、最大値を返す", () => {
    const posts = [
      makePost({ slug: "a", title: "A", publishedAt: "2026-01-01" }),
      makePost({ slug: "b", title: "B", publishedAt: "2026-03-01", updatedAt: "2026-04-01" }),
      makePost({ slug: "c", title: "C", publishedAt: "2026-02-01" }),
    ];
    expect(latestUpdatedAt(posts)).toBe("2026-04-01T00:00:00Z");
  });

  it("updatedAt 不在で publishedAt のみで比較", () => {
    const posts = [
      makePost({ slug: "a", title: "A", publishedAt: "2026-05-01" }),
      makePost({ slug: "b", title: "B", publishedAt: "2026-03-01" }),
    ];
    expect(latestUpdatedAt(posts)).toBe("2026-05-01T00:00:00Z");
  });
});

describe("buildAtomFeed", () => {
  const baseUrl = "https://ryantsuji.dev";

  it("EN feed: xml:lang=en、entry link に ?lang= 付かない、subtitle が英語", () => {
    const xml = buildAtomFeed({
      posts: [makePost({ slug: "hello", title: "Hello", publishedAt: "2026-05-01" })],
      lang: "en",
      baseUrl,
    });
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('xml:lang="en"');
    expect(xml).toContain("Ryan Tsuji&apos;s personal blog");
    expect(xml).toContain("<title>ryantsuji.dev — engineering / design / product</title>");
    expect(xml).toContain('href="https://ryantsuji.dev/rss/en.xml"');
    expect(xml).toContain("<id>https://ryantsuji.dev/posts/hello</id>");
    expect(xml).not.toContain("?lang=ja");
  });

  it("JP feed: xml:lang=ja、entry link に ?lang=ja、subtitle が日本語", () => {
    const xml = buildAtomFeed({
      posts: [
        makePost({ slug: "hello", title: "こんにちは", publishedAt: "2026-05-01", lang: "ja" }),
      ],
      lang: "ja",
      baseUrl,
    });
    expect(xml).toContain('xml:lang="ja"');
    expect(xml).toContain("辻 亮佑");
    expect(xml).toContain("<id>https://ryantsuji.dev/posts/hello?lang=ja</id>");
    expect(xml).toContain('href="https://ryantsuji.dev/posts/hello?lang=ja"');
    expect(xml).toContain('href="https://ryantsuji.dev/rss/ja.xml"');
    expect(xml).toContain("<title>こんにちは</title>");
  });

  it("title / summary の XML 予約文字を escape する (injection 防止)", () => {
    const xml = buildAtomFeed({
      posts: [
        makePost({
          slug: "x",
          title: "<script>alert('xss')</script>",
          publishedAt: "2026-05-01",
          summary: "A & B",
        }),
      ],
      lang: "en",
      baseUrl,
    });
    expect(xml).not.toContain("<script>alert");
    expect(xml).toContain("&lt;script&gt;alert(&apos;xss&apos;)&lt;/script&gt;");
    expect(xml).toContain("A &amp; B");
  });

  it("summary 不在の post は <summary> 要素を出さない", () => {
    const xml = buildAtomFeed({
      posts: [makePost({ slug: "x", title: "X", publishedAt: "2026-05-01" })],
      lang: "en",
      baseUrl,
    });
    expect(xml).not.toContain("<summary");
  });

  it("tags が空なら <category> を出さない、複数なら全部出す", () => {
    const noTags = buildAtomFeed({
      posts: [makePost({ slug: "x", title: "X", publishedAt: "2026-05-01" })],
      lang: "en",
      baseUrl,
    });
    expect(noTags).not.toContain("<category");

    const withTags = buildAtomFeed({
      posts: [
        makePost({
          slug: "x",
          title: "X",
          publishedAt: "2026-05-01",
          tags: ["ai", "mcp"],
        }),
      ],
      lang: "en",
      baseUrl,
    });
    expect(withTags).toContain('<category term="ai"/>');
    expect(withTags).toContain('<category term="mcp"/>');
  });

  it("updatedAt 不在の post は <updated> に publishedAt を流用", () => {
    const xml = buildAtomFeed({
      posts: [makePost({ slug: "x", title: "X", publishedAt: "2026-05-01" })],
      lang: "en",
      baseUrl,
    });
    expect(xml).toContain("<published>2026-05-01T00:00:00Z</published>");
    expect(xml).toContain("<updated>2026-05-01T00:00:00Z</updated>");
  });

  it("post 0 件でも valid な feed shell (entry 無し) を返す", () => {
    const xml = buildAtomFeed({ posts: [], lang: "en", baseUrl });
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom"');
    expect(xml).toContain("</feed>");
    expect(xml).not.toContain("<entry>");
    // feed level <updated> は epoch fallback
    expect(xml).toContain("<updated>1970-01-01T00:00:00Z</updated>");
  });

  it("entry の順序は入力 array をそのまま反映 (呼び出し側で publishedAt 降順済の前提)", () => {
    const xml = buildAtomFeed({
      posts: [
        makePost({ slug: "newer", title: "Newer", publishedAt: "2026-05-10" }),
        makePost({ slug: "older", title: "Older", publishedAt: "2026-01-10" }),
      ],
      lang: "en",
      baseUrl,
    });
    const newerIdx = xml.indexOf("Newer");
    const olderIdx = xml.indexOf("Older");
    expect(newerIdx).toBeLessThan(olderIdx);
  });
});
