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
import { describe, expect, it } from "vitest";

import { getRouter } from "../router.js";
import { Route } from "./index.js";

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
    expect(html).toContain("zenn.dev/ryantsuji");
    expect(html).toContain("dev.to/ryantsuji");
  });
});
