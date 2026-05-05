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
        "infra/**/*.ts",
      ],
      // bin/ や scripts/ の CLI entry point は process.argv / 標準入出力依存で
      // unit test 対象外。pure logic は src/ 側に分離してテスト済。
      exclude: [
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/dist/**",
        "**/node_modules/**",
        // SDK ラッパー: BigQuery / Vertex AI への外部 HTTP 呼び出しが本体で、
        // 純粋ロジック部分は parser 側 (operations-log/threads/memory/strategy) で
        // 既にテスト対象。ここの unit test は real-API 統合テストか E2E でやる。
        "apps/graph/product/src/migrate/common/bq-merge.ts",
        "apps/graph/product/src/migrate/common/embedding.ts",
        // 中間 type 定義のみ (実行時ロジックなし)
        "apps/graph/product/src/migrate/common/types.ts",
        // CLI entry-point: process.argv / staged file 取得 / process.exit のみ。
        // 純粋ロジックは sibling lib で網羅テスト済み。
        "scripts/hooks/*.cli.ts",
        // Pulumi の Pulumi.yaml / Pulumi.<stack>.yaml は code ではない
        "**/Pulumi.*.yaml",
      ],
      // 閾値は **each-file 基準** で強制 (Ryan ルール: 全体平均では 1 ファイル 100% で
      // 他をごまかせるため不採用)。`perFile: true` で coverage.include の各ファイルが
      // 独立に threshold を満たす必要がある。
      //
      // cortex 同型ルール: 「閾値を下げる代わりにテストを追加する」(下げる変更は禁止)。
      // 初期から 90% で開始 (Ryan ルール、2026-05-05): 最初から整えないと運用できない。
      thresholds: {
        perFile: true,
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
  },
});
