/**
 * ryantsuji.dev web の Vite + TanStack Start 設定。
 *
 * TanStack Start v1.167 で deployment target option (`target: 'cloudflare-module'`)
 * は plugin schema から削除され、deploy 先は build 出力の wrapping で決める方式に変わった。
 * このため `vite build` は generic SSR bundle を吐き、`server.ts` (Worker entry) が
 * その SSR handler を import して CF Workers の `fetch(req, env, ctx)` 形式に変換する。
 *
 * RSC は **本 iteration では未有効化**。`docs/spike/rsc.md` に動作確認は済んでおり、
 * 重 dep (shiki / unified) を確実に rsc env に閉じ込める形での導入は次の iteration
 * (`renderServerComponent` 経由の PostBody 化) で扱う。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 個人ブログ web app の Vite build パイプライン。TanStack Start (SSR + file-based routing) を default 設定で動かし、CF Workers 適応は別途 `server.ts` の Worker entry が担う構造に倒す
 * @graph-connects tanstack-start [embeds] tanstackStart() vite plugin を pipeline に組み込み、router 自動生成 + SSR build を成立させる
 */

import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "~": resolve(__dirname, "./src"),
    },
  },
  plugins: [tanstackStart(), viteReact()],
});
