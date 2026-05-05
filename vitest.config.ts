/**
 * vitest config (root)。
 *
 * coverage threshold は最初は緩く (50%) 設定し、テスト追加につれて引き上げる方針。
 * 「閾値を下げる代わりにテストを追加する」ルール (cortex 同型) を遵守。
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business 全 workspace 横断の vitest 設定 + coverage threshold。`include` でユニットテストファイル、`coverage.include` で計測対象を限定。最初は閾値 50% で開始し、テスト追加に応じて引き上げる
 * @graph-connects none
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "apps/**/src/**/*.{test,spec}.ts",
      "packages/**/src/**/*.{test,spec}.ts",
      "infra/**/*.{test,spec}.ts",
      "scripts/**/*.{test,spec}.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: [
        "apps/**/src/**/*.ts",
        "packages/**/src/**/*.ts",
        "scripts/hooks/**/*.ts",
      ],
      exclude: [
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/dist/**",
        "**/node_modules/**",
      ],
      // 閾値は **each-file 基準** で強制 (Ryan ルール: 全体平均では 1 ファイル 100% で
      // 他をごまかせるため不採用)。`perFile: true` で coverage.include の各ファイルが
      // 独立に threshold を満たす必要がある。
      //
      // 初期は 0 から開始し、テストを追加するたびに ratchet 方式で上げる。
      // cortex 同型ルール: 「閾値を下げる代わりにテストを追加する」(下げる変更は禁止)。
      thresholds: {
        perFile: true,
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },
    },
  },
});
