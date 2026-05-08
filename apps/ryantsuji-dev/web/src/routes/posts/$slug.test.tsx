/**
 * `/posts/$slug` (詳細 page) の SSR test。
 *
 * `RouterProvider` + memory history で具体 slug に navigate し、loader 内の
 * `renderMarkdown` 経由で出る title / readingTime / TOC / body 構造を確認する。
 * shiki の cold-start を beforeAll で吸収する pattern は packages/content と同様。
 *
 * 出力 HTML は React の hydration marker 込みなので、business substring を
 * `toMatch` regex で固定する形で testing.md の弱い matcher 禁止に従う。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 投稿詳細 route の SSR + RSC 統合の保証。slug → renderMarkdown → PostBody → HTML までを 1 router pass で render し、title / 本文 / TOC / reading time が出ること、null branch (tags/headings 不在) と 404 boundary が正しく分岐することを確認する
 * @graph-connects none
 */

import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { renderToString } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { renderMarkdown } from "@self/content";

import { getRouter } from "../../router.js";
import { listPosts } from "../../server/posts.js";

async function ssrAt(path: string): Promise<string> {
  const router = getRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  return renderToString(<RouterProvider router={router} />);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("/posts/$slug — detail", () => {
  // shiki / unified の cold-start を吸収 (--coverage 下で 30s 越え対策)
  beforeAll(async () => {
    await renderMarkdown(
      ["---", 'title: "warmup"', 'publishedAt: "2026-05-08"', "---", "warm"].join("\n"),
    );
  }, 60_000);

  it("tags / headings 持ち post は title + body + TOC + tag list 込みで SSR される", async () => {
    const slug = "hello-world"; // tags + headings 多い feature-rich post
    const title = listPosts().find((p) => p.slug === slug)!.title;
    const html = await ssrAt(`/posts/${slug}`);

    expect(html).toMatch(new RegExp(`<h1>${escapeRegex(title)}</h1>`));
    expect(html).toMatch(/<article class="post-body">/);
    expect(html).toMatch(/← all posts/);
    // React は数値と文字列を <!-- --> で挟むので "1<!-- --> min read" の形になる
    expect(html).toMatch(/\d+(?:<!--\s*-->)?\s*min read/);
    expect(html).toMatch(/<aside class="post-detail__toc"/);
    expect(html).toMatch(/<ul class="post-detail__tags">/);
  });

  it("tags / headings の無い minimal post は TOC + tag list を出さない (null branch)", async () => {
    const slug = "minimal";
    const title = listPosts().find((p) => p.slug === slug)!.title;
    const html = await ssrAt(`/posts/${slug}`);

    expect(html).toMatch(new RegExp(`<h1>${escapeRegex(title)}</h1>`));
    expect(html).toMatch(/<article class="post-body">/);
    expect(html).not.toMatch(/<aside class="post-detail__toc"/);
    expect(html).not.toMatch(/<ul class="post-detail__tags">/);
  });

  it("draft post の slug は notFound boundary に倒される (200 boundary、本文なし)", async () => {
    const html = await ssrAt("/posts/_draft-example");
    expect(html).not.toMatch(/<article class="post-body">/);
    expect(html).not.toMatch(/Draft example/);
  });

  it("存在しない slug は notFound boundary に倒される (post body 不出力)", async () => {
    const html = await ssrAt("/posts/this-slug-does-not-exist");
    expect(html).not.toMatch(/<article class="post-body">/);
    expect(html).not.toMatch(/<h1>/); // detail header は出ない
  });
});
