/**
 * `/` (landing page) のユニット test。
 *
 * `IndexPage` は `Link` (router context 必要) を含むので、`RouterProvider` 経由で
 * SSR してから landing copy を確認する。Route export 自体の実体化チェックも兼ねる。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business landing route の copy + /posts への入口リンクが壊れていないことを SSR で保証。Route export 自体も object として存在することを確認
 * @graph-connects none
 */

import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./index.server.js", () => ({
  runLanding: vi.fn(() => ({ lang: "en", latest: [] })),
}));
import { runLanding } from "./index.server.js";

import { getRouter } from "../router.js";
import { Route } from "./index.js";

import type { PostListItem } from "../server/posts.js";

const SAMPLE_LATEST: PostListItem[] = [
  {
    slug: "hello",
    lang: "en",
    title: "Hello World",
    publishedAt: "2026-05-10",
    tags: [],
    syndication: {},
    servedLang: "en",
    availableLangs: ["en"],
  },
];

describe("/ — landing page", () => {
  it("Route export は object として実体化されている", () => {
    expect(Route).toBeTypeOf("object");
    expect(Route).not.toBeNull();
  });

  it("IndexPage SSR が landing copy + /posts 入口を含む", async () => {
    const router = getRouter({
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await router.load();
    const html = renderToString(<RouterProvider router={router} />);
    expect(html).toContain("ryantsuji.dev");
    expect(html).toContain("engineering / design / product");
    expect(html).toContain('href="/posts"');
    expect(html).toContain("zenn.dev/thujikun");
    expect(html).toContain("dev.to/ryantsuji");
  });

  describe("lang / latest 分岐 SSR", () => {
    const runLandingMock = vi.mocked(runLanding);
    beforeEach(() => {
      runLandingMock.mockReset();
    });

    async function ssrAt(initial: string): Promise<string> {
      const router = getRouter({
        history: createMemoryHistory({ initialEntries: [initial] }),
      });
      await router.load();
      return renderToString(<RouterProvider router={router} />);
    }

    it("lang=ja: 日本語 tagline + JP X handle を出す", async () => {
      runLandingMock.mockReturnValue({ lang: "ja", latest: [] });
      const html = await ssrAt("/");
      expect(html).toContain("エンジニアリング・設計・プロダクト");
      // JP の syndicationNote は @RyanAircloset (JP 公式) ではなく Zenn/dev.to link を出す
      expect(html).toContain("Zenn");
      // 投稿一覧 CTA も日本語
      expect(html).toContain("投稿一覧");
    });

    it("lang=en: English tagline + CTA を出す", async () => {
      runLandingMock.mockReturnValue({ lang: "en", latest: [] });
      const html = await ssrAt("/");
      expect(html).toContain("Notes on engineering, design, and product");
      expect(html).toContain("all posts");
    });

    it("latest 件数 > 0 なら latest section を出し、post link を含む", async () => {
      runLandingMock.mockReturnValue({ lang: "en", latest: SAMPLE_LATEST });
      const html = await ssrAt("/");
      expect(html).toMatch(/landing__latest/);
      expect(html).toMatch(/href="\/posts\/hello"/);
      expect(html).toContain("Hello World");
    });

    it("latest 0 件なら latest section を出さない (null branch)", async () => {
      runLandingMock.mockReturnValue({ lang: "en", latest: [] });
      const html = await ssrAt("/");
      expect(html).not.toMatch(/landing__latest-heading/);
    });
  });
});
