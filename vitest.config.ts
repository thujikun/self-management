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

import {
  COVERAGE_EXCLUDE,
  COVERAGE_INCLUDE,
  COVERAGE_THRESHOLDS,
} from "./scripts/hooks/coverage-config.js";

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
    // coverage の include / exclude / threshold は `scripts/hooks/coverage-config.ts`
    // を SSoT として import する。staged 単位 coverage check (`coverage-staged`
    // gate) も同 module を読むため、CI と pre-commit で「coverage 対象集合」が
    // drift しない設計。新規 exclude を増やす時は coverage-config.ts を編集すれば
    // 両方に自動反映される。
    //
    // 閾値運用ルール: 「閾値を下げる代わりにテストを追加する」(下げる変更は禁止)。
    // 初期から 90% で開始 (Ryan ルール、2026-05-05)。
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: [...COVERAGE_INCLUDE],
      exclude: [...COVERAGE_EXCLUDE],
      thresholds: { ...COVERAGE_THRESHOLDS },
    },
  },
});
