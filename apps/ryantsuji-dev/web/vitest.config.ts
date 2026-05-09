/**
 * @self/ryantsuji-dev-web の vitest project 設定。
 *
 * root (`vitest.config.ts`) の `projects` から参照されると、root の coverage /
 * testTimeout / threshold を継承しつつ、本 app 固有の setupFiles (createServerFn
 * test passthrough mock) を上乗せする形で動く。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business ryantsuji-dev/web の vitest project 定義。createServerFn の test passthrough mock を本 app の責務として持ち、root config から path 依存を消す。include は本 app 配下の test だけに限定
 * @graph-connects none
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "ryantsuji-dev-web",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    setupFiles: ["./src/test-setup.ts"],
  },
});
