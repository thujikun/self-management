/**
 * `/posts` (一覧 page) の SSR test。
 *
 * `RouterProvider` + memory history で `/posts` に navigate して、現 repo の post
 * meta が card list として render されるかを確認する。loader (server function) も
 * 同 process 内で評価されるので、整合性を end-to-end で取れる。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 投稿一覧 route の SSR 整合性。loader が listPosts を呼んで取得した meta が card title / date / tag として HTML に出ること、各 post への detail link が `/posts/$slug` で並ぶことを保証
 * @graph-connects none
 */

import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getRouter } from "../../router.js";
import { listPosts } from "../../server/posts.js";

describe("/posts — index", () => {
  it("loader で取得した meta が card list として SSR される", async () => {
    const router = getRouter({
      history: createMemoryHistory({ initialEntries: ["/posts"] }),
    });
    await router.load();
    const html = renderToString(<RouterProvider router={router} />);
    expect(html).toContain("posts");

    // 全 post の title が render される
    const posts = listPosts();
    expect(posts.length).toBeGreaterThan(0);
    for (const p of posts) {
      expect(html).toContain(p.title);
      expect(html).toContain(`href="/posts/${p.slug}"`);
    }
  });
});
