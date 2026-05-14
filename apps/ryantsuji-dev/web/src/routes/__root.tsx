/**
 * Root route — 全 page 共通の HTML shell + provider 配置。
 *
 * `Outlet` 配下に各 page route が render される。`HeadContent` / `Scripts` は
 * TanStack Start の SSR で <head> / <script> を hoist するために必須。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 全ページ共通の HTML shell。<html> / <head> / <body> を 1 箇所で持ち、後続 route は Outlet 配下に流し込む。design-tokens (将来) と Query devtools をここで mount する
 * @graph-connects tanstack-router [provides] Root Route を export してファイルベースルーティングの起点になる
 */

import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";

export interface RouterContext {
  queryClient: QueryClient;
}

/** @graph-connects tanstack-router [provides] root route definition */
export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "ryantsuji.dev" },
      {
        name: "description",
        content: "Ryan Tsuji's personal blog — engineering, design, product.",
      },
    ],
    links: [{ rel: "stylesheet", href: "/styles.css" }],
  }),
  component: RootComponent,
});

/** @graph-connects none */
function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

/** @graph-connects none */
function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <SiteFooter />
        <Scripts />
      </body>
    </html>
  );
}

/**
 * 全 page 共通の footer。/privacy と /terms へのリンクが OAuth provider 要件
 * (X "Request email from users" などで公開 URL の登録を要求される) を満たす入口。
 *
 * @graph-connects tanstack-router [calls] Link で /privacy / /terms に飛ばす
 */
function SiteFooter() {
  return (
    <footer className="site-footer">
      <Link to="/privacy">privacy</Link>
      <span aria-hidden="true">·</span>
      <Link to="/terms">terms</Link>
      <span aria-hidden="true">·</span>
      <a href="https://github.com/thujikun">github</a>
    </footer>
  );
}
