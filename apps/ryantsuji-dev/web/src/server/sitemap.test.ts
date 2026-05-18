/**
 * sitemap.ts (pure XML builder) のテスト。post variant / static / series の各 entry
 * 形式、reciprocal hreflang、x-default の fallback ロジックを inline snapshot で
 * 網羅。本物の `listPosts` には触らず、PostListItem を直書きの fixture で渡す。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business sitemap.ts の pure 関数群 (escapeSitemapXml / postCanonicalUrl / postLastmod / buildPostUrlEntry / buildStaticUrlEntry / buildSitemapXml) を fixture 入力で検証、reciprocal hreflang と x-default fallback の挙動を inline snapshot で固定
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import type { PostListItem } from "./posts.js";
import {
  buildPostUrlEntry,
  buildSitemapXml,
  buildStaticUrlEntry,
  escapeSitemapXml,
  postCanonicalUrl,
  postLastmod,
} from "./sitemap.js";

const BASE = "https://ryantsuji.dev";

describe("escapeSitemapXml", () => {
  it("5 文字を実体参照に置換", () => {
    expect(escapeSitemapXml(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &apos;");
  });
});

describe("postCanonicalUrl", () => {
  it("en は無印 URL", () => {
    expect(postCanonicalUrl(BASE, "hello", "en")).toBe("https://ryantsuji.dev/posts/hello");
  });
  it("ja は ?lang=ja 付き", () => {
    expect(postCanonicalUrl(BASE, "hello", "ja")).toBe("https://ryantsuji.dev/posts/hello?lang=ja");
  });
});

describe("postLastmod", () => {
  it("updatedAt があればそれを使う (10 字に切る)", () => {
    const post = {
      slug: "x",
      title: "x",
      publishedAt: "2026-01-01",
      updatedAt: "2026-05-10T12:00:00Z",
      availableLangs: ["en"],
      servedLang: "en",
    } as PostListItem;
    expect(postLastmod(post)).toBe("2026-05-10");
  });
  it("updatedAt 無ければ publishedAt", () => {
    const post = {
      slug: "x",
      title: "x",
      publishedAt: "2026-01-01",
      availableLangs: ["en"],
      servedLang: "en",
    } as PostListItem;
    expect(postLastmod(post)).toBe("2026-01-01");
  });
});

describe("buildStaticUrlEntry", () => {
  it("lastmod 有り — loc + lastmod を出す", () => {
    expect(buildStaticUrlEntry({ url: `${BASE}/about`, lastmod: "2026-05-18" }))
      .toMatchInlineSnapshot(`
        "  <url>
            <loc>https://ryantsuji.dev/about</loc>
            <lastmod>2026-05-18</lastmod>
          </url>"
      `);
  });
  it("lastmod 無し — loc のみ", () => {
    expect(buildStaticUrlEntry({ url: `${BASE}/privacy` })).toMatchInlineSnapshot(`
      "  <url>
          <loc>https://ryantsuji.dev/privacy</loc>
        </url>"
    `);
  });
  it("URL の特殊文字を escape", () => {
    expect(buildStaticUrlEntry({ url: `${BASE}/x?a=1&b=2` })).toMatchInlineSnapshot(`
      "  <url>
          <loc>https://ryantsuji.dev/x?a=1&amp;b=2</loc>
        </url>"
    `);
  });
});

describe("buildPostUrlEntry", () => {
  it("en/ja 両方ある post の en variant — 3 つの alternate (en / ja / x-default→en) が乗る", () => {
    expect(
      buildPostUrlEntry({
        baseUrl: BASE,
        slug: "hello",
        servedLang: "en",
        availableLangs: ["en", "ja"],
        lastmod: "2026-05-15",
      }),
    ).toMatchInlineSnapshot(`
      "  <url>
          <loc>https://ryantsuji.dev/posts/hello</loc>
          <lastmod>2026-05-15</lastmod>
          <xhtml:link rel="alternate" hreflang="en" href="https://ryantsuji.dev/posts/hello"/>
          <xhtml:link rel="alternate" hreflang="ja" href="https://ryantsuji.dev/posts/hello?lang=ja"/>
          <xhtml:link rel="alternate" hreflang="x-default" href="https://ryantsuji.dev/posts/hello"/>
        </url>"
    `);
  });

  it("ja variant — 同じ alternate set (reciprocal)、loc だけ ja URL", () => {
    expect(
      buildPostUrlEntry({
        baseUrl: BASE,
        slug: "hello",
        servedLang: "ja",
        availableLangs: ["en", "ja"],
        lastmod: "2026-05-15",
      }),
    ).toMatchInlineSnapshot(`
      "  <url>
          <loc>https://ryantsuji.dev/posts/hello?lang=ja</loc>
          <lastmod>2026-05-15</lastmod>
          <xhtml:link rel="alternate" hreflang="en" href="https://ryantsuji.dev/posts/hello"/>
          <xhtml:link rel="alternate" hreflang="ja" href="https://ryantsuji.dev/posts/hello?lang=ja"/>
          <xhtml:link rel="alternate" hreflang="x-default" href="https://ryantsuji.dev/posts/hello"/>
        </url>"
    `);
  });

  it("en のみの post — ja alternate 出さない、x-default は en に倒す", () => {
    expect(
      buildPostUrlEntry({
        baseUrl: BASE,
        slug: "en-only",
        servedLang: "en",
        availableLangs: ["en"],
        lastmod: "2026-05-15",
      }),
    ).toMatchInlineSnapshot(`
      "  <url>
          <loc>https://ryantsuji.dev/posts/en-only</loc>
          <lastmod>2026-05-15</lastmod>
          <xhtml:link rel="alternate" hreflang="en" href="https://ryantsuji.dev/posts/en-only"/>
          <xhtml:link rel="alternate" hreflang="x-default" href="https://ryantsuji.dev/posts/en-only"/>
        </url>"
    `);
  });

  it("ja のみの post — en 無いので x-default は ja URL に倒す", () => {
    expect(
      buildPostUrlEntry({
        baseUrl: BASE,
        slug: "ja-only",
        servedLang: "ja",
        availableLangs: ["ja"],
        lastmod: "2026-05-15",
      }),
    ).toMatchInlineSnapshot(`
      "  <url>
          <loc>https://ryantsuji.dev/posts/ja-only?lang=ja</loc>
          <lastmod>2026-05-15</lastmod>
          <xhtml:link rel="alternate" hreflang="ja" href="https://ryantsuji.dev/posts/ja-only?lang=ja"/>
          <xhtml:link rel="alternate" hreflang="x-default" href="https://ryantsuji.dev/posts/ja-only?lang=ja"/>
        </url>"
    `);
  });
});

describe("buildSitemapXml", () => {
  it("空集合 — XML header + 空 urlset を出す", () => {
    expect(
      buildSitemapXml({
        baseUrl: BASE,
        posts: [],
        seriesSlugs: [],
        staticPaths: [],
        buildDate: "2026-05-18",
      }),
    ).toMatchInlineSnapshot(`
      "<?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
              xmlns:xhtml="http://www.w3.org/1999/xhtml">
      </urlset>
      "
    `);
  });

  it("static + series + post 混在 — 順序 (static → series → post variant) で出力", () => {
    const posts: PostListItem[] = [
      {
        slug: "hello",
        title: "Hello",
        publishedAt: "2026-05-10",
        updatedAt: "2026-05-15",
        availableLangs: ["en", "ja"],
        servedLang: "en",
      } as PostListItem,
    ];
    expect(
      buildSitemapXml({
        baseUrl: BASE,
        posts,
        seriesSlugs: ["building-ai-harness"],
        staticPaths: ["/", "/about"],
        buildDate: "2026-05-18",
      }),
    ).toMatchInlineSnapshot(`
      "<?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
              xmlns:xhtml="http://www.w3.org/1999/xhtml">
        <url>
          <loc>https://ryantsuji.dev/</loc>
          <lastmod>2026-05-18</lastmod>
        </url>
        <url>
          <loc>https://ryantsuji.dev/about</loc>
          <lastmod>2026-05-18</lastmod>
        </url>
        <url>
          <loc>https://ryantsuji.dev/series/building-ai-harness</loc>
          <lastmod>2026-05-18</lastmod>
        </url>
        <url>
          <loc>https://ryantsuji.dev/posts/hello</loc>
          <lastmod>2026-05-15</lastmod>
          <xhtml:link rel="alternate" hreflang="en" href="https://ryantsuji.dev/posts/hello"/>
          <xhtml:link rel="alternate" hreflang="ja" href="https://ryantsuji.dev/posts/hello?lang=ja"/>
          <xhtml:link rel="alternate" hreflang="x-default" href="https://ryantsuji.dev/posts/hello"/>
        </url>
        <url>
          <loc>https://ryantsuji.dev/posts/hello?lang=ja</loc>
          <lastmod>2026-05-15</lastmod>
          <xhtml:link rel="alternate" hreflang="en" href="https://ryantsuji.dev/posts/hello"/>
          <xhtml:link rel="alternate" hreflang="ja" href="https://ryantsuji.dev/posts/hello?lang=ja"/>
          <xhtml:link rel="alternate" hreflang="x-default" href="https://ryantsuji.dev/posts/hello"/>
        </url>
      </urlset>
      "
    `);
  });

  it("post の availableLangs 順で alternate emit (en → ja 順)", () => {
    const posts: PostListItem[] = [
      {
        slug: "a",
        title: "A",
        publishedAt: "2026-01-01",
        availableLangs: ["en", "ja"],
        servedLang: "en",
      } as PostListItem,
    ];
    const xml = buildSitemapXml({
      baseUrl: BASE,
      posts,
      seriesSlugs: [],
      staticPaths: [],
      buildDate: "2026-05-18",
    });
    // en variant entry 内で en alternate が ja より先に並ぶ (en/ja 各 variant につき同様)
    const enIdx = xml.indexOf('hreflang="en"');
    const jaIdx = xml.indexOf('hreflang="ja"');
    expect(enIdx).toBeGreaterThan(0);
    expect(jaIdx).toBeGreaterThan(enIdx);
  });
});
