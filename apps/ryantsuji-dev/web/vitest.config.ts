/**
 * @self/ryantsuji-dev-web の vitest project 設定。
 *
 * root (`vitest.config.ts`) の `projects` から参照されると、root の coverage /
 * testTimeout / threshold を継承しつつ、本 app 固有の setupFiles (createServerFn
 * test passthrough mock) を上乗せする形で動く。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business ryantsuji-dev/web の vitest project 定義。createServerFn の test passthrough mock を本 app の責務として持ち、root config から path 依存を消す。include は本 app 配下の test だけに限定。CSS の `?url` import は Vite が test 環境で空文字列に解決するため、href の中身を assert できるよう virtual module で固定 URL に差し替える
 * @graph-connects none
 */

import { resolve } from "node:path";

import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";

import { renderedPostsPlugin } from "./vite-plugins/rendered-posts.js";

/**
 * test 環境で `*.css?url` import を resolve するための固定 sentinel URL。
 *
 * production の build pipeline では Vite が hash 付き `/assets/styles-<hash>.css`
 * を emit するが、vitest 環境では Vite の css plugin が url を emit しないため
 * default export が空文字列になり、`href: ""` の React warning が出るうえ test
 * 側で href の中身を assert できない (= 旧 `href: "/styles.css"` literal 直書き
 * regression を再発防止できない)。本 plugin で `?url` を sentinel に差し替え、
 * test が href の literal 値を `toStrictEqual` できる状態を作る。
 *
 * 値は **空 CSS の data URI** (= `data:text/css;base64,Lyo=` → `/*`)。
 * happy-dom 上で `createRoot().render(<RouterProvider />)` が走ると `<link
 * rel="stylesheet" href="...">` を自動 fetch しようとするため、`/__test__/...`
 * のような相対 URL だと `http://localhost:3000/__test__/styles.css` への connect
 * が refused になり unhandled rejection で vitest が exit 1 する。data URI なら
 * happy-dom が inline 解決して network を踏まないので、test 側の href 一致 assert
 * は維持したまま、coverage gate を fail させずに済む。
 *
 * @graph-connects none
 */
const TEST_CSS_URL = "data:text/css;base64,Lyo=";

/**
 * `*.css?url` import を vitest 環境で sentinel URL に解決する Vite plugin。
 *
 * vite-node の実行系では Vite の virtual module load よりも CSS 既定処理が
 * 先に勝ち、`?url` import が空文字列に解決されてしまうため、ソース側で
 * import 文を直接 sentinel への const 宣言に書き換える `transform` 方式を
 * 採る。`enforce: "pre"` で他の transformer より前に適用する。
 *
 * @graph-connects none
 */
/** @graph-connects none */
const CSS_URL_IMPORT_RE = /import\s+(\w+)\s+from\s+["'][^"']+\.css\?url["'];?/g;

/** @graph-connects none */
const cssUrlTestStub: Plugin = {
  name: "ryantsuji-dev-web/css-url-test-stub",
  enforce: "pre",
  transform(code, id) {
    if (id.includes("/node_modules/") || !/\.(t|j)sx?$/.test(id)) return null;
    if (!CSS_URL_IMPORT_RE.test(code)) return null;
    CSS_URL_IMPORT_RE.lastIndex = 0;
    const replaced = code.replace(
      CSS_URL_IMPORT_RE,
      (_match, ident: string) => `const ${ident} = ${JSON.stringify(TEST_CSS_URL)};`,
    );
    return { code: replaced, map: null };
  },
};

export default defineConfig({
  plugins: [
    cssUrlTestStub,
    // vitest からも `virtual:rendered-posts` を提供する。production build と同じ
    // pre-render を test の前に流すことで、posts.ts → getRenderedPost の経路を
    // 実 markdown 上で踏める (= mocking なしで integration test が成立)。
    renderedPostsPlugin(resolve(__dirname, "content/posts")),
  ],
  test: {
    name: "ryantsuji-dev-web",
    include: ["src/**/*.{test,spec}.{ts,tsx}", "vite-plugins/**/*.{test,spec}.ts"],
    setupFiles: ["./src/test-setup.ts"],
    // React component の click / submit dispatch を test するため happy-dom を採用。
    // SSR test (renderToString) も happy-dom 上で問題なく動く (DOM API を使わないため)。
    environment: "happy-dom",
  },
});
