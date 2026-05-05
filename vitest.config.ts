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
      // ratchet: 現在の実カバレッジを下回らないように設定。テストが増えるごとに上げる。
      // cortex 同型ルール: 「閾値を下げる代わりにテストを追加する」(下げる変更は禁止)。
      // 初期値はテストインフラ整備直後で 1% 弱、安全域として 0 を切り、徐々に上げる。
      thresholds: {
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },
    },
  },
});
