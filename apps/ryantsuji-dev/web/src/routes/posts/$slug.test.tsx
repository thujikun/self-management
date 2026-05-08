/**
 * `/posts/$slug` (詳細 page) の SSR test。
 *
 * `RouterProvider` + memory history で具体 slug に navigate し、loader 内の
 * `renderMarkdown` 経由で出る title / readingTime / TOC / body 構造を確認する。
 * shiki の cold-start を beforeAll で吸収する pattern は packages/content と同様。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 投稿詳細 route の SSR + RSC 統合の保証。slug → renderMarkdown → PostBody Flight stream → HTML までを 1 router pass で render し、title / 本文 / TOC / reading time が出ることを確認する
 * @graph-connects none
 */

import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { renderToString } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { renderMarkdown } from "@self/content";

import { getRouter } from "../../router.js";
import { listPosts } from "../../server/posts.js";

describe("/posts/$slug — detail", () => {
  // shiki / unified の cold-start を吸収 (--coverage 下で 30s 越え対策)
  beforeAll(async () => {
    await renderMarkdown(
      ["---", 'title: "warmup"', 'publishedAt: "2026-05-08"', "---", "warm"].join("\n"),
    );
  }, 60_000);

  it("tags / headings 持ち post は TOC + tag list 込みで SSR される", async () => {
    const slug = "hello-world"; // tags + headings 多い feature-rich post
    const router = getRouter({
      history: createMemoryHistory({ initialEntries: [`/posts/${slug}`] }),
    });
    await router.load();
    const html = renderToString(<RouterProvider router={router} />);
    const title = listPosts().find((p) => p.slug === slug)!.title;
    expect(html).toContain(title);
    expect(html).toContain('<article class="post-body"');
    expect(html).toContain("← all posts");
    // React は数値と文字列を <!-- --> で挟むので "1<!-- --> min read" の形になる
    expect(html).toMatch(/\d+(?:<!--\s*-->)?\s*min read/);
    // TOC + tag list が描画される
    expect(html).toContain('aria-label="目次"');
    expect(html).toContain('class="post-detail__tags"');
  });

  it("tags / headings の無い minimal post は TOC + tag list を出さない (null branch)", async () => {
    const router = getRouter({
      history: createMemoryHistory({ initialEntries: ["/posts/minimal"] }),
    });
    await router.load();
    const html = renderToString(<RouterProvider router={router} />);
    expect(html).toContain("Minimal post");
    expect(html).toContain('<article class="post-body"');
    expect(html).not.toContain('aria-label="目次"');
    expect(html).not.toContain('class="post-detail__tags"');
  });

  it("存在しない slug は loader から notFound() が throw される (404 branch)", async () => {
    const router = getRouter({
      history: createMemoryHistory({ initialEntries: ["/posts/not-a-real-slug"] }),
    });
    await router.load();
    // notFound throw 後の挙動 — router は 404 boundary に倒すので landing copy は出ない。
    // 重要なのは loader 内の `if (!source)` branch を到達させること。
    const html = renderToString(<RouterProvider router={router} />);
    expect(html).not.toContain('<article class="post-body"');
  });
});
