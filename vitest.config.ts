/**
 * vitest config (root)。
 *
 * **vitest projects pattern** で各 workspace の concern を分離する:
 * - 一般 workspace (graph / mcp / packages / infra / scripts) は root の default
 *   project (inline) が拾う
 * - `apps/ryantsuji-dev/web` は自身の `vitest.config.ts` で setupFiles
 *   (`createServerFn` の test passthrough mock) を所有し、root はそのパスへの
 *   依存を持たない
 *
 * coverage / testTimeout / threshold は root レベルで一元管理 (per-file 90% を
 * 全 project に適用)。
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business 全 workspace 横断の vitest 設定。projects pattern で各 app の concern を per-app vitest.config.ts に隔離し、root は default project (graph/mcp/packages/infra/scripts) と coverage threshold + testTimeout を握る
 * @graph-connects none
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      // app 固有 setup を持つ workspace (vitest.config.ts を参照)
      "apps/ryantsuji-dev/web",
      // setupFiles 不要な共通 workspace 群はここに inline で定義
      {
        extends: true,
        test: {
          name: "default",
          include: [
            "apps/graph/**/src/**/*.{test,spec}.{ts,tsx}",
            "apps/mcp/**/src/**/*.{test,spec}.{ts,tsx}",
            "packages/**/src/**/*.{test,spec}.{ts,tsx}",
            "infra/**/*.{test,spec}.{ts,tsx}",
            "scripts/**/*.{test,spec}.{ts,tsx}",
          ],
        },
      },
    ],
    // ts-morph in-memory project の cold-start (`apps/graph/.../code/parser.test.ts`)
    // が full-suite 並列負荷時に default 5s に届かず flake するため 30s に拡張。
    // monorepo の依存数が増える (turbo / TanStack 系で +169 packages) と worker の
    // import phase が線形悪化し、cold-start テストが届かなくなる。30s は通常の
    // unit test 上限としては十分余裕で、これを超えるなら "実バグ" として扱う前提。
    // pool: "threads" を試したが、共有状態を前提とするテストが破綻するため fork のまま。
    // 次の閾値突破時 (60s 級) は timeout 拡張ではなく `globalSetup` で ts-morph
    // project を prewarm して cold-start 自体を短くする方針に切替える。
    testTimeout: 30000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: [
        "apps/**/src/**/*.{ts,tsx}",
        "packages/**/src/**/*.{ts,tsx}",
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
        "scripts/*.cli.ts",
        // Pulumi の Pulumi.yaml / Pulumi.<stack>.yaml は code ではない
        "**/Pulumi.*.yaml",
        // TanStack Router 自動生成 routeTree (commit 済だが human-authored ではないので coverage 計測対象外)
        "**/routeTree.gen.ts",
        // vitest setup は test infrastructure (mock 定義) なので coverage 計測対象外。
        // pure logic を持つ場合は src/ に切り出してテスト対象にする。
        "**/test-setup.ts",
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
