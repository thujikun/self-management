/**
 * `/about` の SSR test。
 *
 * RouterProvider + memory history で `/about` に navigate して、bio / avatar /
 * 主要過去記事 link / 外部 platform link / RSS link の存在を確認する。会社ロゴが
 * 出ていないことも regression として固定する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business /about route の SSR 整合性。bio + 顔写真 + 主要過去記事 link + 外部 platform link + RSS link が出ること、会社ロゴが入っていないことを regression として固定
 * @graph-connects none
 */

import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./__root.server.js", () => ({
  runResolveLang: vi.fn(() => ({ lang: "en", theme: null })),
}));
import { runResolveLang } from "./__root.server.js";

import { getRouter } from "../router.js";

describe("/about — author profile", () => {
  beforeEach(() => {
    vi.mocked(runResolveLang).mockReturnValue({ lang: "en", theme: null });
  });

  it("avatar + h1 (Ryan Tsuji) + airCloset CTO の bio が出る", async () => {
    const router = getRouter({ history: createMemoryHistory({ initialEntries: ["/about"] }) });
    await router.load();
    const html = renderToString(<RouterProvider router={router} />);

    expect(html).toMatch(/<main class="about"/);
    expect(html).toMatch(/<img[^>]*src="\/avatar\.jpg"[^>]*class="about__avatar"/);
    expect(html).toMatch(/Ryan Tsuji/);
    expect(html).toMatch(/airCloset, Inc\./);
    expect(html).toMatch(/<strong>cortex<\/strong>/);
  });

  it("主要過去記事 5 件の Link が並ぶ (内部 /posts/$slug への href)", async () => {
    const router = getRouter({ history: createMemoryHistory({ initialEntries: ["/about"] }) });
    await router.load();
    const html = renderToString(<RouterProvider router={router} />);
    for (const slug of [
      "ai-harness-intro",
      "agentic-graph-rag-mcp",
      "mcp-parking-pattern",
      "17-mcp-servers",
      "db-graph-mcp",
    ]) {
      expect(html).toMatch(new RegExp(`href="/posts/${slug}"`));
    }
  });

  it("Series in progress として /series/building-ai-harness link が出る", async () => {
    const router = getRouter({ history: createMemoryHistory({ initialEntries: ["/about"] }) });
    await router.load();
    const html = renderToString(<RouterProvider router={router} />);
    expect(html).toMatch(/href="\/series\/building-ai-harness"/);
  });

  it("外部 platform link (X EN / X JP / GitHub / dev.to / Zenn / LinkedIn) が全部 target=_blank + rel=noopener noreferrer", async () => {
    const router = getRouter({ history: createMemoryHistory({ initialEntries: ["/about"] }) });
    await router.load();
    const html = renderToString(<RouterProvider router={router} />);
    const externals = [
      "https://corp.air-closet.com/",
      "https://x.com/ryantsuji",
      "https://x.com/RyanAircloset",
      "https://github.com/thujikun",
      "https://dev.to/ryantsuji",
      "https://zenn.dev/aircloset",
      "https://www.linkedin.com/in/ryosuketsuji/",
    ];
    for (const url of externals) {
      // url を含む anchor が target="_blank" + rel に noopener noreferrer の両方を持つ
      // (React は属性順を変えるので、anchor tag 範囲内に両方含まれることだけ確認)
      const re = new RegExp(
        `<a[^>]*href="${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*target="_blank"[^>]*rel="noopener noreferrer"`,
      );
      expect(html).toMatch(re);
    }
  });

  it("RSS link (EN / JP) と mailto: hello@ryantsuji.dev が出る", async () => {
    const router = getRouter({ history: createMemoryHistory({ initialEntries: ["/about"] }) });
    await router.load();
    const html = renderToString(<RouterProvider router={router} />);
    expect(html).toMatch(/<a[^>]*href="\/rss\/en\.xml"[^>]*>RSS \(EN\)<\/a>/);
    expect(html).toMatch(/<a[^>]*href="\/rss\/ja\.xml"[^>]*>RSS \(JP\)<\/a>/);
    expect(html).toMatch(/href="mailto:hello@ryantsuji\.dev"/);
  });

  it("会社ロゴは出さない (個人ブログ identity 優先)", async () => {
    const router = getRouter({ history: createMemoryHistory({ initialEntries: ["/about"] }) });
    await router.load();
    const html = renderToString(<RouterProvider router={router} />);
    // logo image は logo-mark.svg (header / favicon) のみで OK。airCloset ロゴ画像が
    // 紛れ込んでいないこと (`aircloset-logo` 等の class / file 名が無いこと) を固定
    expect(html).not.toMatch(/aircloset[^"]*logo/i);
    expect(html).not.toMatch(/aircloset[^"]*\.(?:png|jpg|svg)/i);
  });

  it("head に description / og:title / og:image (/avatar.jpg) が出る", async () => {
    const router = getRouter({ history: createMemoryHistory({ initialEntries: ["/about"] }) });
    await router.load();
    const html = renderToString(<RouterProvider router={router} />);
    expect(html).toMatch(/<title>About — ryantsuji\.dev<\/title>/);
    expect(html).toMatch(
      /<meta[^>]*property="og:url"[^>]*content="https:\/\/ryantsuji\.dev\/about"/,
    );
    expect(html).toMatch(
      /<meta[^>]*property="og:image"[^>]*content="https:\/\/ryantsuji\.dev\/avatar\.jpg"/,
    );
  });

  it("lang=en: '書いていること' ではなく 'What I write about' を出す", async () => {
    vi.mocked(runResolveLang).mockReturnValue({ lang: "en", theme: null });
    const router = getRouter({ history: createMemoryHistory({ initialEntries: ["/about"] }) });
    await router.load();
    const html = renderToString(<RouterProvider router={router} />);
    expect(html).toMatch(/What I write about/);
    expect(html).toMatch(/Recent posts/);
    expect(html).toMatch(/Elsewhere/);
    expect(html).not.toMatch(/書いていること/);
  });

  it("lang=ja: 日本語の見出し / 本文 / リンクラベルを出す (cortex / airCloset 等の固有名は維持)", async () => {
    vi.mocked(runResolveLang).mockReturnValue({ lang: "ja", theme: null });
    const router = getRouter({ history: createMemoryHistory({ initialEntries: ["/about"] }) });
    await router.load();
    const html = renderToString(<RouterProvider router={router} />);
    // JA 見出し / ラベル
    expect(html).toMatch(/書いていること/);
    expect(html).toMatch(/最近の投稿/);
    expect(html).toMatch(/ほかの場所/);
    expect(html).toMatch(/連載中/);
    expect(html).toMatch(/ホームに戻る/);
    // 固有名は JA でも維持
    expect(html).toMatch(/airCloset, Inc\./);
    expect(html).toMatch(/<strong>cortex<\/strong>/);
    expect(html).toMatch(/<strong>ハーネスエンジニアリング<\/strong>/);
    // EN 文言は出ない (lang=en 表記の確認)
    expect(html).not.toMatch(/What I write about/);
  });
});
