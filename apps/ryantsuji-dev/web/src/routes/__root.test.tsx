/**
 * Root route (`__root.tsx`) のユニット test。
 *
 * `head()` で返るメタタグ群と、Component を `RouterProvider` 経由で SSR した結果に
 * `<html>` shell + landing コピーが含まれていることを確認する。後者の test は
 * router.tsx (`getRouter`) と routes/index.tsx (`IndexPage`) も同時に network 上で
 * 通過するため、3 ファイル分の coverage を一度に稼ぐ統合 path として機能する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 全ページ共通の HTML shell + meta が壊れないことを SSR で保証。RouterProvider 経由で render することで router.tsx + index.tsx も同 path で実行され、3 ファイル分の coverage を 1 統合テストで取れる
 * @graph-connects none
 */

import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getRouter } from "../router.js";
import { Route } from "./__root.js";

describe("__root route", () => {
  it("head() に title / charset / viewport / theme-color / og meta を含む", async () => {
    const headFn = Route.options.head;
    if (!headFn) throw new Error("Route.options.head is undefined");
    // head() は Awaitable<T> (= T | Promise<T>) なので await で unwrap する
    const head = await Promise.resolve(
      headFn(undefined as unknown as Parameters<typeof headFn>[0]),
    );

    const meta = head.meta ?? [];
    expect(meta).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ charSet: "utf-8" }),
        expect.objectContaining({ name: "viewport" }),
        expect.objectContaining({ title: "ryantsuji.dev" }),
        expect.objectContaining({ name: "theme-color", content: "#0abab5" }),
        expect.objectContaining({
          property: "og:url",
          content: "https://ryantsuji.dev",
        }),
        expect.objectContaining({
          property: "og:image",
          content: "https://ryantsuji.dev/og-image.png",
        }),
        expect.objectContaining({ name: "twitter:card", content: "summary_large_image" }),
        expect.objectContaining({
          name: "twitter:image",
          content: "https://ryantsuji.dev/og-image.png",
        }),
      ]),
    );

    // crawler が相対 path を解決しないため、og / twitter 画像と og:url は
    // 必ず https:// 始まりの絶対 URL になっていること
    const ogImage = meta.find(
      (m): m is { property: string; content: string } =>
        typeof m === "object" && m !== null && "property" in m && m.property === "og:image",
    );
    expect(ogImage?.content.startsWith("https://")).toBe(true);
    const twitterImage = meta.find(
      (m): m is { name: string; content: string } =>
        typeof m === "object" && m !== null && "name" in m && m.name === "twitter:image",
    );
    expect(twitterImage?.content.startsWith("https://")).toBe(true);
    const ogUrl = meta.find(
      (m): m is { property: string; content: string } =>
        typeof m === "object" && m !== null && "property" in m && m.property === "og:url",
    );
    expect(ogUrl?.content.startsWith("https://")).toBe(true);

    // `?url` import は vitest.config.ts の `cssUrlTestStub` plugin により
    // `/__test__/styles.css` に解決される。production build では Vite が
    // `/assets/styles-<hash>.css` を emit する経路で、href が非空文字列になる
    // ことは build 経由で別途担保。ここでは「`?url` import から href に値が
    // 流れている」ことを sentinel URL の literal 一致で固定し、`href:
    // "/styles.css"` 直書きへの regression や `href: ""` (= build pipeline
    // 非経由) への regression を test 側で必ず捕まえる。
    const links = head.links ?? [];
    expect(links).toStrictEqual([
      { rel: "stylesheet", href: "/__test__/styles.css" },
      { rel: "icon", type: "image/svg+xml", href: "/logo-mark.svg" },
      { rel: "icon", type: "image/x-icon", href: "/favicon.ico" },
      { rel: "icon", type: "image/png", sizes: "48x48", href: "/favicon-48x48.png" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" },
      { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
      {
        rel: "alternate",
        type: "application/atom+xml",
        href: "/rss/en.xml",
        title: "ryantsuji.dev (EN)",
      },
      {
        rel: "alternate",
        type: "application/atom+xml",
        href: "/rss/ja.xml",
        title: "ryantsuji.dev (JP)",
      },
    ]);
  });

  it("RouterProvider 経由で root document + landing が SSR される", async () => {
    const router = getRouter({
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await router.load();

    const html = renderToString(<RouterProvider router={router} />);
    expect(html).toContain("<html");
    expect(html).toContain("<title>ryantsuji.dev</title>");
    // landing copy: 「engineering / design / product」を主軸に
    expect(html).toContain("engineering / design / product");
    expect(html).toContain('href="/posts"');
  });
});
