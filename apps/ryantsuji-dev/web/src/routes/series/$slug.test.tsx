/**
 * `/series/$slug` の SSR test。
 *
 * `RouterProvider` + memory history で `/series/building-ai-harness` に navigate
 * して、登録済 series が hub 構造 (heading / tagline / Part 列) で render される
 * か、未登録 slug は notFound が走るかを確認する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 連載 hub route /series/$slug の SSR 整合性。SERIES_REGISTRY 登録 slug は title / tagline / Part listing を出し、未登録 slug は notFound に倒れることを保証。各 post への詳細 link も Part 順で出る
 * @graph-connects none
 */

import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getRouter } from "../../router.js";
import type { PostListItem } from "../../server/posts.js";
import type { SeriesMeta } from "../../server/series.js";
import { SeriesHubBody } from "./$slug.js";

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

const fakeMeta: SeriesMeta = {
  slug: "fake",
  title: "Fake Series",
  tagline: "test fixture",
};

describe("/series/$slug — series hub", () => {
  it("building-ai-harness: title / tagline / Part 1 link が出る (EN)", async () => {
    const router = getRouter({
      history: createMemoryHistory({ initialEntries: ["/series/building-ai-harness?lang=en"] }),
    });
    await router.load();
    const html = renderToString(<RouterProvider router={router} />);

    // hub 構造
    expect(html).toMatch(/<main class="series"/);
    expect(html).toMatch(/<h1>Building AI Harness<\/h1>/);
    expect(html).toMatch(/series__tagline/);
    expect(html).toMatch(/series__list/);

    // Part 1 の ai-harness-intro が listed (EN ラベル)
    expect(html).toMatch(/series__item-part/);
    expect(html).toMatch(/Part/);
    expect(html).toMatch(/href="\/posts\/ai-harness-intro"/);
  });

  it("?lang=ja で Part 文言が日本語表記 (第 N 回)", async () => {
    const router = getRouter({
      history: createMemoryHistory({ initialEntries: ["/series/building-ai-harness?lang=ja"] }),
    });
    await router.load();
    const html = renderToString(<RouterProvider router={router} />);
    expect(html).toMatch(/第/);
    expect(html).toMatch(/回/);
    // 1 本 post の本数表示も日本語 unit
    expect(html).toMatch(/本/);
  });

  it("post 数 (count) が表示される", async () => {
    const router = getRouter({
      history: createMemoryHistory({ initialEntries: ["/series/building-ai-harness?lang=en"] }),
    });
    await router.load();
    const html = renderToString(<RouterProvider router={router} />);
    // React の SSR が text node 間に `<!-- -->` を挟むので、`>2...posts<` の包括 match で確認
    expect(html).toMatch(/<p class="series__count">2(?:<!-- -->| )+posts<\/p>/);
  });

  it("head に canonical / og:type / og:image / twitter:card が出る", async () => {
    const router = getRouter({
      history: createMemoryHistory({ initialEntries: ["/series/building-ai-harness?lang=en"] }),
    });
    await router.load();
    const html = renderToString(<RouterProvider router={router} />);
    expect(html).toMatch(
      /<link[^>]*rel="canonical"[^>]*href="https:\/\/ryantsuji\.dev\/series\/building-ai-harness"/,
    );
    expect(html).toMatch(/<meta[^>]*property="og:type"[^>]*content="website"/);
    expect(html).toMatch(/<meta[^>]*property="og:image"[^>]*og-image\.png/);
    expect(html).toMatch(/<meta[^>]*name="twitter:card"[^>]*content="summary_large_image"/);
  });

  it("未登録 slug は notFound 経路に倒れる (404 component が render される)", async () => {
    const router = getRouter({
      history: createMemoryHistory({ initialEntries: ["/series/not-a-real-series"] }),
    });
    await router.load();
    const html = renderToString(<RouterProvider router={router} />);
    // notFound 時は <main class="series"> heading の "Building AI Harness" は出ない
    expect(html).not.toMatch(/<h1>Building AI Harness<\/h1>/);
  });
});

/**
 * `SeriesHubBody` の direct render test。Route.useLoaderData() を介さず controlled
 * data で各 branch (empty / multi-post / summary 無し / seriesOrder fallback / ja
 * vs en の文言切替) を踏む。`<Link>` が Router context を要求するため、最小限の
 * RouterProvider を被せて renderToString する helper を経由する。
 */
describe("SeriesHubBody (direct render)", () => {
  // SeriesHubBody は bare anchor (`<a href>`) を使うので Router context 不要、
  // renderToString に直接渡せる。
  function renderBody(args: Parameters<typeof SeriesHubBody>[0]): string {
    return renderToString(<SeriesHubBody {...args} />);
  }

  it("empty posts (0 件): empty placeholder が出て ol は出ない (EN)", () => {
    const html = renderBody({ meta: fakeMeta, posts: [], lang: "en" });
    expect(html).toMatch(/no posts yet\./);
    expect(html).not.toMatch(/<ol class="series__list">/);
    // count: "0 posts" (複数形 branch)
    expect(html).toMatch(/series__count">0(?:<!-- -->| )+posts/);
  });

  it("empty posts (0 件) JA: 「まだ記事がありません」「0 本」", () => {
    const html = renderBody({ meta: fakeMeta, posts: [], lang: "ja" });
    expect(html).toMatch(/まだ記事がありません。/);
    expect(html).toMatch(/series__count">0(?:<!-- -->| )+本/);
  });

  it("複数 post EN: count が `posts` (複数形)", () => {
    const html = renderBody({
      meta: fakeMeta,
      posts: [makePost({ slug: "a", seriesOrder: 1 }), makePost({ slug: "b", seriesOrder: 2 })],
      lang: "en",
    });
    expect(html).toMatch(/series__count">2(?:<!-- -->| )+posts/);
  });

  it("seriesOrder 未指定 post は i+1 fallback で Part 番号が出る", () => {
    const html = renderBody({
      meta: fakeMeta,
      posts: [makePost({ slug: "p", title: "P", summary: undefined })],
      lang: "en",
    });
    // i=0 → order=1 が rendered
    expect(html).toMatch(/series__item-part[^>]*>Part(?:<!-- -->| )+1/);
  });

  it("summary 無し post は series__item-summary を render しない", () => {
    const html = renderBody({
      meta: fakeMeta,
      posts: [makePost({ slug: "p", summary: undefined })],
      lang: "en",
    });
    expect(html).not.toMatch(/series__item-summary/);
  });

  it("summary 有り post は series__item-summary が render される", () => {
    const html = renderBody({
      meta: fakeMeta,
      posts: [makePost({ slug: "p", summary: "intro paragraph" })],
      lang: "en",
    });
    expect(html).toMatch(/<p class="series__item-summary">intro paragraph<\/p>/);
  });

  it("ja lang: Part 文言が「第 N 回」", () => {
    const html = renderBody({
      meta: fakeMeta,
      posts: [makePost({ slug: "p", seriesOrder: 2 })],
      lang: "ja",
    });
    expect(html).toMatch(/第(?:<!-- -->| )+2/);
    expect(html).toMatch(/回/);
  });
});
