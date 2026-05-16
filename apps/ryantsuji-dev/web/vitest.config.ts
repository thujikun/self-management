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

import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";

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
 * @graph-connects none
 */
const TEST_CSS_URL = "/__test__/styles.css";

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
  plugins: [cssUrlTestStub],
  test: {
    name: "ryantsuji-dev-web",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    setupFiles: ["./src/test-setup.ts"],
    // React component の click / submit dispatch を test するため happy-dom を採用。
    // SSR test (renderToString) も happy-dom 上で問題なく動く (DOM API を使わないため)。
    environment: "happy-dom",
  },
});
