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

    // 全 post の title / detail link が render される (test では Accept-Language が
    // 取れないので server fn 内 pickLang は "en" にフォールバックする想定)
    const posts = listPosts("en");
    expect(posts.length).toBeGreaterThan(0);
    for (const p of posts) {
      // title は <h2 class="post-card__title"> の中に入る。React の SSR が `'` を
      // `&#x27;` に escape する等で全文一致が壊れるので、HTML entity escape を考慮した
      // 比較関数を使う。
      expect(html).toMatch(
        new RegExp(`<h2 class="post-card__title">${escapeRegexForHtmlBody(p.title)}</h2>`),
      );
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

  it("?lang=ja で override すると post の lang badge (JA) が served になる", async () => {
    const router = getRouter({
      history: createMemoryHistory({ initialEntries: ["/posts?lang=ja"] }),
    });
    await router.load();
    const html = renderToString(<RouterProvider router={router} />);
    // 個別 post card の lang badge は override に従って JA served に。
    // header の LangSwitcher は cookie 主体 (override は per-page) なので参照しない。
    expect(html).toMatch(/post-card__lang post-card__lang--served[^>]*>JA/);
  });

  it("?lang=en で override すると post の lang badge (EN) が served になる", async () => {
    const router = getRouter({
      history: createMemoryHistory({ initialEntries: ["/posts?lang=en"] }),
    });
    await router.load();
    const html = renderToString(<RouterProvider router={router} />);
    expect(html).toMatch(/post-card__lang post-card__lang--served[^>]*>EN/);
  });
});

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * React SSR は `<`, `>`, `&`, `'`, `"` を HTML entity に escape する。比較対象の
 * title が apostrophe や `&` を含むと regex 直比較が壊れるので、entity 化した形に
 * 揃えた上で regex 用に escape する。
 */
function escapeRegexForHtmlBody(s: string): string {
  const entityMap: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#x27;",
  };
  const htmlEscaped = s.replace(/[&<>"']/g, (ch) => entityMap[ch] ?? ch);
  return escapeRegex(htmlEscaped);
}
