/**
 * ryantsuji.dev web の Vite + TanStack Start + RSC + Cloudflare Workers 設定。
 *
 * `@cloudflare/vite-plugin` を **先頭** に置くことで、TanStack Start の ssr environment
 * を Worker module として bundle し、`wrangler.jsonc:main` の `@tanstack/react-start/server-entry`
 * を解決する (TanStack `start-core/deployment` SKILL 推奨パターン)。`viteEnvironment: { name: "ssr" }`
 * で「どの vite environment を Worker bundle にするか」を明示する。
 *
 * `tanstackStart({ rsc: { enabled: true } })` + `@vitejs/plugin-rsc` で 5 environment
 * (api / middleware / **rsc** / client / ssr) build に展開。`createServerFn().handler()`
 * 内から呼ぶ重 dep (shiki / unified) は rsc env のみに bundle され、client にも ssr にも
 * 漏れない。spike record は `docs/spike/rsc.md`。
 *
 * `server.entry: "./src/server.ts"` で本 app 固有の Worker entry を wire し、Workers
 * が渡す `(req, env, ctx)` を TanStack Start handler の `requestContext: { env, ctx }`
 * に forward する。これにより server fn / middleware から `context.env.X` で型付き
 * binding を読める (process.env を介さない)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 個人ブログ web app の Vite build パイプライン。`@cloudflare/vite-plugin` を先頭に置いて ssr environment を Worker bundle 化し、TanStack Start の RSC build と React SWC を後段に重ねる。`server.entry` で本 app 固有の Worker entry を指し、env binding を requestContext に forward する設計
 * @graph-connects tanstack-start [embeds] tanstackStart({ rsc, server }) で router 自動生成 + SSR + RSC + 独自 server entry を統合
 * @graph-connects cloudflare [embeds] @cloudflare/vite-plugin で ssr env を Worker module bundle に変換、wrangler が main を解決する
 */

import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import rsc from "@vitejs/plugin-rsc";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "~": resolve(__dirname, "./src"),
    },
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr", childEnvironments: ["rsc"] } }),
    tanstackStart({ rsc: { enabled: true }, server: { entry: "./src/server.ts" } }),
    rsc(),
    viteReact(),
  ],
});
