// @ts-check

/**
 * self-management ESLint config (minimal)。
 *
 * 主目的:
 * - 抑制コメント (eslint-disable / @ts-ignore 等) 禁止 (CLAUDE.md ルール 2)
 * - TypeScript strict + recommended-type-checked
 *
 * 機械的なテスト coverage threshold や @graph-* タグ強制は scripts/hooks/* で実施。
 * 専用 ESLint plugin は self-management の規模では不要。
 */

import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "**/coverage/**",
      ".pnpm-store/**",
      "infra/core/Pulumi.*.yaml",
      // apps/xmcp は Python アプリ。.venv 配下に Python パッケージ同梱の .js があり
      // browser global (document/navigator/...) 前提で no-undef を大量に出すので除外。
      "apps/xmcp/**",
      // TanStack Router 自動生成 (commit 済) — ファイル先頭に @ts-nocheck を含むため
      // eslint / format / check-no-ignore の対象外にする。生成内容は機械的なので人手 review しない。
      "**/routeTree.gen.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      // 抑制コメントは scripts/hooks/check-no-ignore.sh で禁止しているが、ESLint 側でも警告
      "no-warning-comments": ["warn", { terms: ["fixme", "xxx"], location: "anywhere" }],
      // 未使用変数は型を消すかアンダースコアプレフィックスに
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // any 禁止 (unknown を使う)
      "@typescript-eslint/no-explicit-any": "error",
      // console は明示的に使う場合のみ
      "no-console": ["warn", { allow: ["log", "warn", "error"] }],
    },
  },
);
