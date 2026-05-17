/**
 * `server/series.ts` の test。
 *
 * `listPosts` を vi.mock で fake post 配列に差し替え、`getSeriesMeta` (slug hit /
 * miss)、`listSeriesPosts` (順序 + `seriesOrder` 未指定 fallback)、`getSeriesNav`
 * (current 端点 prev=null / next=null / 非 series 投稿 null) を網羅する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business series helper の単体 test。listPosts の戻り値を mock で固定し、各 helper の sort / fallback / 端点 branch を網羅
 * @graph-connects none
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Lang } from "./i18n.js";
import type { PostListItem } from "./posts.js";

vi.mock("./posts.js", async () => {
  const actual = await vi.importActual<typeof import("./posts.js")>("./posts.js");
  return {
    ...actual,
    listPosts: vi.fn(),
  };
});

const { listPosts } = await import("./posts.js");
const { getSeriesMeta, listSeriesPosts, getSeriesNav, SERIES_REGISTRY } =
  await import("./series.js");

function makePost(over: Partial<PostListItem> & Pick<PostListItem, "slug">): PostListItem {
  return {
    slug: over.slug,
    lang: over.lang ?? "en",
    title: over.title ?? `Title ${over.slug}`,
    publishedAt: over.publishedAt ?? "2026-05-10",
    summary: over.summary,
    tags: over.tags ?? [],
    draft: over.draft ?? false,
    series: over.series,
    seriesOrder: over.seriesOrder,
    syndication: over.syndication ?? {},
    cover: over.cover,
    availableLangs: over.availableLangs ?? ["en"],
    servedLang: over.servedLang ?? "en",
  } satisfies PostListItem;
}

const mockListPosts = vi.mocked(listPosts);

beforeEach(() => {
  mockListPosts.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SERIES_REGISTRY", () => {
  it("building-ai-harness が登録されていて canonical 値を持つ", () => {
    const meta = SERIES_REGISTRY["building-ai-harness"];
    expect(meta?.slug).toBe("building-ai-harness");
    expect(meta?.title).toMatch(/Building AI Harness/);
    expect(meta?.tagline.length).toBeGreaterThan(20);
  });
});

describe("getSeriesMeta", () => {
  it("hit: 登録済 slug は SeriesMeta を返す", () => {
    expect(getSeriesMeta("building-ai-harness")?.title).toMatch(/Building AI Harness/);
  });

  it("miss: 未登録 slug は null", () => {
    expect(getSeriesMeta("not-a-real-series")).toBeNull();
  });
});

describe("listSeriesPosts", () => {
  const lang: Lang = "en";

  it("series slug でフィルタし seriesOrder 昇順に並べる", () => {
    mockListPosts.mockReturnValue([
      makePost({ slug: "c", series: "x", seriesOrder: 3, publishedAt: "2026-05-30" }),
      makePost({ slug: "a", series: "x", seriesOrder: 1, publishedAt: "2026-05-10" }),
      makePost({ slug: "b", series: "x", seriesOrder: 2, publishedAt: "2026-05-20" }),
      makePost({ slug: "other", series: "y", seriesOrder: 1 }),
      makePost({ slug: "noseries" }),
    ]);
    const out = listSeriesPosts("x", lang);
    expect(out.map((p) => p.slug)).toStrictEqual(["a", "b", "c"]);
  });

  it("seriesOrder 未指定の post は publishedAt 昇順 fallback (= 末尾に来る)", () => {
    mockListPosts.mockReturnValue([
      makePost({ slug: "ordered-2", series: "x", seriesOrder: 2 }),
      makePost({ slug: "fallback-late", series: "x", publishedAt: "2026-06-01" }),
      makePost({ slug: "ordered-1", series: "x", seriesOrder: 1 }),
      makePost({ slug: "fallback-early", series: "x", publishedAt: "2026-05-01" }),
    ]);
    const out = listSeriesPosts("x", lang);
    expect(out.map((p) => p.slug)).toStrictEqual([
      "ordered-1",
      "ordered-2",
      "fallback-early",
      "fallback-late",
    ]);
  });

  it("該当 post 無し → 空配列", () => {
    mockListPosts.mockReturnValue([makePost({ slug: "x" })]);
    expect(listSeriesPosts("nope", lang)).toStrictEqual([]);
  });

  it("同 seriesOrder の post は publishedAt 昇順で安定 sort", () => {
    mockListPosts.mockReturnValue([
      makePost({
        slug: "tie-later",
        series: "x",
        seriesOrder: 1,
        publishedAt: "2026-06-01",
      }),
      makePost({
        slug: "tie-earlier",
        series: "x",
        seriesOrder: 1,
        publishedAt: "2026-05-01",
      }),
    ]);
    expect(listSeriesPosts("x", lang).map((p) => p.slug)).toStrictEqual([
      "tie-earlier",
      "tie-later",
    ]);
  });

  it("seriesOrder 全件未指定 → publishedAt 昇順", () => {
    mockListPosts.mockReturnValue([
      makePost({ slug: "later", series: "x", publishedAt: "2026-06-01" }),
      makePost({ slug: "earlier", series: "x", publishedAt: "2026-05-01" }),
    ]);
    expect(listSeriesPosts("x", lang).map((p) => p.slug)).toStrictEqual(["earlier", "later"]);
  });
});

describe("getSeriesNav", () => {
  const lang: Lang = "en";

  function setupBuildingAiHarness(parts: number) {
    const posts: PostListItem[] = [];
    for (let i = 1; i <= parts; i++) {
      posts.push(
        makePost({
          slug: `part-${i}`,
          series: "building-ai-harness",
          seriesOrder: i,
          title: `Part ${i}`,
        }),
      );
    }
    mockListPosts.mockReturnValue(posts);
  }

  it("post が series に属していなければ null", () => {
    mockListPosts.mockReturnValue([makePost({ slug: "lonely" })]);
    expect(getSeriesNav("lonely", lang)).toBeNull();
  });

  it("post が存在しなければ null", () => {
    mockListPosts.mockReturnValue([]);
    expect(getSeriesNav("missing", lang)).toBeNull();
  });

  it("series が SERIES_REGISTRY に未登録なら null", () => {
    mockListPosts.mockReturnValue([
      makePost({ slug: "x", series: "unregistered-series", seriesOrder: 1 }),
    ]);
    expect(getSeriesNav("x", lang)).toBeNull();
  });

  it("1 件のみ: prev/next 両方 null + index 0", () => {
    setupBuildingAiHarness(1);
    const nav = getSeriesNav("part-1", lang);
    expect(nav?.currentIndex).toBe(0);
    expect(nav?.prev).toBeNull();
    expect(nav?.next).toBeNull();
    expect(nav?.posts).toHaveLength(1);
  });

  it("先頭 (Part 1): prev=null, next=Part 2", () => {
    setupBuildingAiHarness(3);
    const nav = getSeriesNav("part-1", lang);
    expect(nav?.currentIndex).toBe(0);
    expect(nav?.prev).toBeNull();
    expect(nav?.next?.slug).toBe("part-2");
  });

  it("中間 (Part 2): prev=Part 1, next=Part 3", () => {
    setupBuildingAiHarness(3);
    const nav = getSeriesNav("part-2", lang);
    expect(nav?.currentIndex).toBe(1);
    expect(nav?.prev?.slug).toBe("part-1");
    expect(nav?.next?.slug).toBe("part-3");
  });

  it("末尾 (Part 3): prev=Part 2, next=null", () => {
    setupBuildingAiHarness(3);
    const nav = getSeriesNav("part-3", lang);
    expect(nav?.currentIndex).toBe(2);
    expect(nav?.prev?.slug).toBe("part-2");
    expect(nav?.next).toBeNull();
  });
});

describe("listSeriesPosts / getSeriesNav: includeDrafts pass-through", () => {
  const lang: Lang = "en";

  it("listSeriesPosts({includeDrafts}) → listPosts({includeDrafts}) に転送", () => {
    mockListPosts.mockReturnValue([]);
    listSeriesPosts("building-ai-harness", lang, { includeDrafts: true });
    expect(mockListPosts).toHaveBeenLastCalledWith(lang, { includeDrafts: true });
  });

  it("listSeriesPosts (option 省略) は空 options を listPosts に渡す (= 公開挙動)", () => {
    mockListPosts.mockReturnValue([]);
    listSeriesPosts("building-ai-harness", lang);
    // options 省略の場合は空 object を pass-through するだけ。listPosts 側で
    // `includeDrafts: false` に解釈される (entries(false) memo を引く)。
    expect(mockListPosts).toHaveBeenLastCalledWith(lang, {});
  });

  it("getSeriesNav({includeDrafts}) → listPosts({includeDrafts}) に転送", () => {
    mockListPosts.mockReturnValue([
      makePost({ slug: "p1", series: "building-ai-harness", seriesOrder: 1 }),
    ]);
    getSeriesNav("p1", lang, { includeDrafts: true });
    // listPosts は getSeriesNav 内で 2 回呼ばれる (current 検索 + listSeriesPosts)。
    // 両方とも includeDrafts: true を持つこと。
    expect(mockListPosts.mock.calls.every(([, opt]) => opt?.includeDrafts === true)).toBe(true);
  });
});
