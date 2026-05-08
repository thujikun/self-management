/**
 * TanStack Router 構築のエントリ。
 *
 * `routeTree.gen.ts` は `@tanstack/router-plugin` が `vite dev` / `vite build` 中に
 * 自動生成する。この loader は SSR / client 両方から import される。
 *
 * v1.167+ では `@tanstack/react-router-with-query` 専用 wrapper は廃止され、
 * `createRootRouteWithContext` で QueryClient を context 注入するだけで OK。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business TanStack Router の root instance を構築し、ファイルベース route tree を SSR と client で共有する。Query Client を context 注入することで loader / hook が共有 cache を使える構造を維持する
 * @graph-connects react-query [embeds] QueryClient を router context に注入し、後続の loader / hook が共有 cache を使えるようにする
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter as createTanstackRouter } from "@tanstack/react-router";
import type { RouterHistory } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { routeTree } from "./routeTree.gen";

/**
 * Router instance を作成。
 *
 * TanStack Start v1.167+ は router entry file から `getRouter` という名前の export を
 * 期待する (`#tanstack-router-entry` virtual module 経由でロードされる)。
 * SSR / client の双方から呼ばれ、1 リクエスト 1 instance。
 *
 * `opts.history` は test から `createMemoryHistory()` を流し込むためだけの seam で、
 * production runtime からは渡さない (TanStack Start が browser/server history を選ぶ)。
 *
 * @graph-connects tanstack-router [returns] QueryClient を context に持つ Router instance を返す
 */
export function getRouter(opts?: { history?: RouterHistory }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
      },
    },
  });

  return createTanstackRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
    Wrap: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
    ...(opts?.history ? { history: opts.history } : {}),
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
