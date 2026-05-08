/**
 * `/posts` (一覧 page) の SSR test。
 *
 * `RouterProvider` + memory history で `/posts` に navigate して、現 repo の post
 * meta が card list として render されるかを確認する。loader (server function) も
 * 同 process 内で評価されるので、整合性を end-to-end で取れる。
 *
 * 出力 HTML は React のバージョン bump で hydration marker が揺れるため、business
 * substring (post title / detail link / list 構造) を `toMatch` regex で固定する
 * 形を採る (testing.md 推奨の hybrid pattern)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 投稿一覧 route の SSR 整合性。loader が listPosts を呼んで取得した meta が card title / date / detail link として HTML に出ること、各 post への detail link が `/posts/$slug` で並ぶことを保証
 * @graph-connects none
 */

import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getRouter } from "../../router.js";
import { listPosts } from "../../server/posts.js";

describe("/posts — index", () => {
  it("各 published post の title + detail link が card-list に並ぶ", async () => {
    const router = getRouter({
      history: createMemoryHistory({ initialEntries: ["/posts"] }),
    });
    await router.load();
    const html = renderToString(<RouterProvider router={router} />);

    // 一覧 page の構造が固定 class で出ること
    expect(html).toMatch(/<ul class="post-card-list">/);

    // 全 post の title / detail link が render される
    const posts = listPosts();
    expect(posts.length).toBeGreaterThan(0);
    for (const p of posts) {
      // title は <h2 class="post-card__title"> の中に入る
      expect(html).toMatch(new RegExp(`<h2 class="post-card__title">${escapeRegex(p.title)}</h2>`));
      // detail への Link は href="/posts/<slug>" で出る
      expect(html).toMatch(new RegExp(`href="/posts/${escapeRegex(p.slug)}"`));
    }
  });

  it("draft post の slug は一覧に現れない (URL 漏出防止)", async () => {
    const router = getRouter({
      history: createMemoryHistory({ initialEntries: ["/posts"] }),
    });
    await router.load();
    const html = renderToString(<RouterProvider router={router} />);
    expect(html).not.toMatch(/href="\/posts\/_draft-example"/);
  });
});

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
