/**
 * ryantsuji.dev web の Vite + TanStack Start + RSC 設定。
 *
 * TanStack Start v1.167 で deployment target option (`target: 'cloudflare-module'`)
 * は plugin schema から削除され、deploy 先は build 出力の wrapping で決める方式に変わった。
 * このため `vite build` は generic SSR bundle を吐き、`server.ts` (Worker entry) が
 * その SSR handler を import して CF Workers の `fetch(req, env, ctx)` 形式に変換する。
 *
 * `tanstackStart({ rsc: { enabled: true } })` + `@vitejs/plugin-rsc` で 5 environment
 * (api / middleware / **rsc** / client / ssr) build に展開。`createServerFn().handler()`
 * 内から呼ぶ重 dep (shiki / unified) は rsc env のみに bundle され、client にも ssr
 * にも漏れない。spike record は `docs/spike/rsc.md`。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 個人ブログ web app の Vite build パイプライン。TanStack Start (SSR + RSC + file-based routing) を有効化、`@vitejs/plugin-rsc` で React Flight protocol を成立させ、shiki 等の重 dep を rsc env (server bundle) に閉じ込める。CF Workers 適応は別途 `server.ts` の Worker entry が担う構造に倒す
 * @graph-connects tanstack-start [embeds] tanstackStart({ rsc: { enabled: true } }) で router 自動生成 + SSR + RSC build を成立させる
 */

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
  plugins: [tanstackStart({ rsc: { enabled: true } }), rsc(), viteReact()],
});
