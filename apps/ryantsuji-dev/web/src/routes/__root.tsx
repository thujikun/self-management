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

// `?url` で Vite に CSS asset として import させ、hashed pathname を取得する。
// 直書きの `/styles.css` だと Vite が emit せず 404 する (src/styles.css は
// public/ に置いてないため static serve されない) ので、必ず import 経由で
// build pipeline に乗せる。
import appCss from "../styles.css?url";

export interface RouterContext {
  queryClient: QueryClient;
}

/**
 * 本番公開 URL。Facebook Sharing Debugger / Twitter Card Validator / Slack 等の
 * external crawler は HTML の og:image / twitter:image / og:url を raw 文字列として
 * 読むため、相対 path だと resolve に失敗する。OGP 仕様 (ogp.me) も og:image は
 * 絶対 URL を要求する。wrangler.jsonc の custom_domain routes と一致させる。
 *
 * @graph-connects none
 */
const SITE_URL = "https://ryantsuji.dev";

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
      { name: "theme-color", content: "#0abab5" },
      // OG / Twitter Card (sub-label 付き logo を社外 share の preview に)
      // crawler が解決できるよう絶対 URL で送出する
      { property: "og:title", content: "ryantsuji.dev" },
      {
        property: "og:description",
        content: "Ryan Tsuji's personal blog — engineering, design, product.",
      },
      { property: "og:url", content: SITE_URL },
      { property: "og:image", content: `${SITE_URL}/og-image.png` },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: `${SITE_URL}/og-image.png` },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      // favicon: SVG (modern browsers) + ICO fallback + 各 raster size
      // Mochiy Pop One letterforms を path 化した self-contained SVG (font 依存無し)
      { rel: "icon", type: "image/svg+xml", href: "/logo-mark.svg" },
      { rel: "icon", type: "image/x-icon", href: "/favicon.ico" },
      { rel: "icon", type: "image/png", sizes: "48x48", href: "/favicon-48x48.png" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" },
      { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
      // RSS feed (Atom 1.0、EN / JP 分離)。reader の自動検出はこの <link
      // rel="alternate"> を見るので、両 lang を declare する。title は reader UI
      // にそのまま並ぶので lang label を明示
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
    ],
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
