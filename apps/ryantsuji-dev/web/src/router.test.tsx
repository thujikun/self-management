/**
 * `getRouter()` 構築のユニット test。
 *
 * Router instance が QueryClient context を持ち、Wrap で QueryClientProvider が
 * 注入されていることを確認する。実 navigation path は `routes/__root.test.tsx` の
 * 統合 test 側で網羅。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business getRouter() が QueryClient を context に持つ Router instance を返すことの保証。Wrap が QueryClientProvider を inject することを SSR で確認し、後続の loader / hook が共有 cache を使える前提を staticly 担保する
 * @graph-connects none
 */

import { QueryClient, useQueryClient } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRoute,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getRouter } from "./router.js";

describe("getRouter", () => {
  it("router instance を返し context に QueryClient を含む", () => {
    const router = getRouter();
    expect(router).toBeTypeOf("object");
    const ctx = router.options.context as { queryClient: QueryClient };
    expect(ctx.queryClient).toBeInstanceOf(QueryClient);
  });

  it("Wrap が QueryClientProvider を inject (useQueryClient が解決できる)", async () => {
    // 独立した micro-router を立てて Wrap (= QueryClientProvider) のみの動作を確認する。
    // 本物 routeTree は __root.test.tsx が網羅するので、ここでは Wrap の責務だけを
    // 単離してテストする。
    const probeRoot = createRootRoute({
      component: () => {
        const qc = useQueryClient();
        return <span data-qc={qc instanceof QueryClient ? "ok" : "fail"} />;
      },
    });
    const probeIndex = createRoute({
      getParentRoute: () => probeRoot,
      path: "/",
      component: () => <></>,
    });
    const real = getRouter();
    const probeRouter = createRouter({
      routeTree: probeRoot.addChildren([probeIndex]),
      context: real.options.context,
      Wrap: real.options.Wrap,
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await probeRouter.load();
    const html = renderToString(<RouterProvider router={probeRouter} />);
    expect(html).toContain('data-qc="ok"');
  });
});
