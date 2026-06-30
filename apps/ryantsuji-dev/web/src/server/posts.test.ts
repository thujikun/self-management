/**
 * `server/posts.ts` の post loader が `virtual:rendered-posts` (vite plugin が build 時
 * に renderMarkdown 済の `Record<filename, RenderedDoc>` を expose) を読み、
 * `listPosts(lang)` / `getRenderedPost(slug, lang)` を期待通り提供するかの test。
 *
 * 実 markdown source (apps/ryantsuji-dev/web/content/posts/) を `renderedPostsPlugin` が
 * test 実行時にも同 plugin 経由で pre-render し、`virtual:rendered-posts` として供給する。
 * en/ja variant は filename suffix で判別される。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business post loader の構造保証。listPosts(lang) が要求 lang variant + en fallback で新着順を返すこと、getRenderedPost(slug, lang) が published source を返し未知 slug で null を返すこと、availableLangs / servedLang が正しく報告されること
 * @graph-connects none
 */

import { describe, expect, it, vi } from "vitest";

import { __testing, getRenderedPost, listPosts } from "./posts.js";

describe("listPosts(lang)", () => {
  it("en 要求で少なくとも 1 件返り、publishedAt 降順で並ぶ", () => {
    const posts = listPosts("en");
    expect(posts.length).toBeGreaterThanOrEqual(1);
    const dates = posts.map((p) => p.publishedAt);
    const sorted = [...dates].sort((a, b) => b.localeCompare(a));
    expect(dates).toStrictEqual(sorted);
  });

  it("ja 要求でも slug 単位で dedupe される (= 件数は en と同じ)", () => {
    const en = listPosts("en");
    const ja = listPosts("ja");
    expect(ja.length).toBe(en.length);
    // slug の set が一致する
    expect(new Set(ja.map((p) => p.slug))).toStrictEqual(new Set(en.map((p) => p.slug)));
  });

  it("publishedAt 未来の post は public listing から除外される (旧 draft: true 相当)", () => {
    const posts = listPosts("en");
    const now = Date.now();
    for (const p of posts) {
      expect(new Date(p.publishedAt).getTime()).toBeLessThanOrEqual(now);
    }
  });

  it("includeDrafts: true を渡すと publishedAt 未来の post も listing に含む (admin preview)", () => {
    const publicPosts = listPosts("en");
    const withDrafts = listPosts("en", { includeDrafts: true });
    // 少なくとも 1 つは pending が増えていなければ、 テスト fixture に未来 publishedAt の記事が無い
    expect(withDrafts.length).toBeGreaterThanOrEqual(publicPosts.length);
    const now = Date.now();
    const pendingSlugs = withDrafts
      .filter((p) => new Date(p.publishedAt).getTime() > now)
      .map((p) => p.slug);
    // pending mode で pending 記事 1 つでも見えるなら admin preview 経路は機能している
    if (pendingSlugs.length > 0) {
      for (const slug of pendingSlugs) {
        expect(publicPosts.find((p) => p.slug === slug)).toBeUndefined();
      }
    }
  });

  it("各 post の slug / title / publishedAt が schema 準拠 + servedLang / availableLangs が付く", () => {
    for (const p of listPosts("en")) {
      expect(p.slug).toMatch(/^[\w-]+$/);
      expect(p.title.length).toBeGreaterThan(0);
      expect(p.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
      expect(p.availableLangs.length).toBeGreaterThanOrEqual(1);
      expect(p.availableLangs).toContain(p.servedLang);
    }
  });

  it("ja variant が無い post は ja 要求でも en fallback で返り servedLang='en'", () => {
    // import 直後の状態: 全 post が en のみ (Zenn 持ち込み前)。ja を要求すると
    // 全 post の servedLang が 'en' になる前提。
    const ja = listPosts("ja");
    for (const p of ja) {
      if (!p.availableLangs.includes("ja")) {
        expect(p.servedLang).toBe("en");
      }
    }
  });

  it("`_` prefix slug (fixture / 内部用) は production 一覧から除外される", () => {
    // `_minimal-fixture.en.md` / `_draft-example.en.md` のいずれも /posts 一覧には
    // 露出させない (pending = publishedAt 未来 は visibleEntries() で公開経路から落ちる
    // 別 mechanism、本 filter は pending でない fixture を listing 表面から隠す convention)。
    const slugs = new Set(listPosts("en").map((p) => p.slug));
    expect(slugs.has("_minimal-fixture")).toBe(false);
    expect(slugs.has("_draft-example")).toBe(false);
    // 直接アクセス (getRenderedPost) は引続き fixture を返すこと
    expect(getRenderedPost("_minimal-fixture", "en")).not.toBeNull();
  });

  it("meta.lang は filename suffix 由来で servedLang と必ず一致する (frontmatter 側の値は採用しない)", () => {
    // `toMeta` が filename 由来 lang を inject するので、`PostMeta.lang` は常に
    // 返した variant の lang (= servedLang) と一致する。frontmatter で誤って
    // 別 lang を書いても sile に PostMeta に混入しない invariant。
    for (const p of listPosts("en")) {
      expect(p.lang).toBe(p.servedLang);
    }
    for (const p of listPosts("ja")) {
      expect(p.lang).toBe(p.servedLang);
    }
  });
});

describe("getRenderedPost(slug, lang)", () => {
  it("既存 published slug + en で pre-rendered HTML + frontmatter を返す", () => {
    // ja-only post が最新になると `listPosts("en")[0]` は ja fallback variant を
    // 返し、続く `getRenderedPost(slug, "en")` の servedLang が 'ja' に落ちる。
    // en variant を持つ post に絞って lookup する。
    const slug = listPosts("en").find((p) => p.availableLangs.includes("en"))?.slug ?? "";
    const result = getRenderedPost(slug, "en");
    expect(result).not.toBeNull();
    expect(result?.rendered.html).toContain("<");
    expect(result?.rendered.frontmatter.title.length).toBeGreaterThan(0);
    expect(result?.rendered.readingTimeMinutes).toBeGreaterThan(0);
    expect(result?.servedLang).toBe("en");
    expect(result?.availableLangs).toContain("en");
  });

  it("存在しない slug で null", () => {
    expect(getRenderedPost("does-not-exist-anywhere", "en")).toBeNull();
  });

  it("ja 要求で ja variant が無ければ en fallback (servedLang='en')", () => {
    // `_minimal-fixture` は en variant のみ (test fixture)
    const result = getRenderedPost("_minimal-fixture", "ja");
    expect(result).not.toBeNull();
    expect(result?.servedLang).toBe("en");
    expect(result?.availableLangs).toEqual(["en"]);
  });

  it("ja variant がある post を ja 要求すると servedLang='ja'", () => {
    // dev.to + Zenn pair が揃っている post を抽出
    const pair = listPosts("ja").find((p) => p.availableLangs.includes("ja"));
    expect(pair).toBeDefined();
    const result = getRenderedPost(pair!.slug, "ja");
    expect(result?.servedLang).toBe("ja");
    expect(result?.availableLangs).toContain("ja");
  });

  it("pending (publishedAt 未来) post の slug でも null (公開経路から漏らさない)", () => {
    // _draft-example.en.md は frontmatter で publishedAt 未来 (旧 draft: true 相当)
    expect(getRenderedPost("_draft-example", "en")).toBeNull();
  });

  it("includeDrafts: true で pending post の slug も lookup できる (admin preview)", () => {
    expect(getRenderedPost("_draft-example", "en", { includeDrafts: true })).not.toBeNull();
    // default (= public) 経路は変化なし
    expect(getRenderedPost("_draft-example", "en")).toBeNull();
  });

  it("pending post は publishedAt 到来で同一 process でも公開される (memo に焼かない)", () => {
    // 公開境界は entries memo に焼き込まず per-request 評価する。fake timer で
    // _draft-example の publishedAt を跨いで Date.now() を進め、同一 isolate のまま
    // null → 公開 へ flip することを確認する (旧 memo 実装は (b) で null のまま stale)。
    vi.useFakeTimers();
    try {
      // (a) 公開予定時刻より前: pending なので公開経路は null
      vi.setSystemTime(new Date("2000-01-01T00:00:00Z"));
      expect(getRenderedPost("_draft-example", "en")).toBeNull();
      // (b) publishedAt を確実に過ぎた時刻に進めると同一 process でも公開される
      vi.setSystemTime(new Date("9999-12-31T23:59:59Z"));
      expect(getRenderedPost("_draft-example", "en")?.servedLang).toBe("en");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("variantFor (internal、fallback ロジックと invariant 破れの fail-fast)", () => {
  // 実 content が常に en を持つため、ja-only branch は in-memory entry で test する
  const fakeJaVariant = {
    meta: {
      title: "Ja-only test",
      publishedAt: "2026-01-01",
      slug: "_ja-only-test",
      tags: [],
      syndication: {},
      lang: "ja" as const,
    },
    rendered: {
      html: "<p>ja body</p>",
      frontmatter: {
        title: "Ja-only test",
        publishedAt: "2026-01-01",
        tags: [],
        syndication: {},
      },
      headings: [],
      readingTimeMinutes: 1,
    },
  };

  it("ja-only entry を en 要求すると ja に fallback (servedLang='ja')", () => {
    const entry = { slug: "_ja-only-test", variants: { ja: fakeJaVariant } };
    const out = __testing.variantFor(entry, "en");
    expect(out.servedLang).toBe("ja");
    expect(out.variant).toBe(fakeJaVariant);
  });

  it("ja-only entry を ja 要求すると direct hit (servedLang='ja')", () => {
    const entry = { slug: "_ja-only-test", variants: { ja: fakeJaVariant } };
    const out = __testing.variantFor(entry, "ja");
    expect(out.servedLang).toBe("ja");
  });

  it("variants が空の entry は console.error + throw (silent fallback しない)", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => __testing.variantFor({ slug: "broken-fixture", variants: {} }, "en")).toThrow(
      /empty variants for broken-fixture/,
    );
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("empty variants for slug=broken-fixture"),
    );
    errSpy.mockRestore();
  });
});

describe("parsePath (internal、filename 規約の防御パース)", () => {
  it("`<slug>.<lang>.md` 形式を分解して { slug, lang } を返す", () => {
    expect(__testing.parseFilename("../../content/posts/db-graph-mcp.en.md")).toEqual({
      slug: "db-graph-mcp",
      lang: "en",
    });
    expect(__testing.parseFilename("foo/bar/example.ja.md")).toEqual({
      slug: "example",
      lang: "ja",
    });
  });

  it("`<slug>.md` (lang suffix 無し) は null", () => {
    expect(__testing.parseFilename("./hello.md")).toBeNull();
  });

  it("未対応 lang suffix (e.g. `.fr.md`) は null", () => {
    expect(__testing.parseFilename("./hello.fr.md")).toBeNull();
  });

  it("非 md は null", () => {
    expect(__testing.parseFilename("./hello.en.txt")).toBeNull();
  });

  it("空文字 path も crash せず null", () => {
    expect(__testing.parseFilename("")).toBeNull();
  });
});
