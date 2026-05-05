// @ts-check

/**
 * self-management ESLint config (minimal)。
 *
 * 主目的:
 * - 抑制コメント (eslint-disable / @ts-ignore 等) 禁止 (CLAUDE.md ルール 2)
 * - TypeScript strict + recommended-type-checked
 *
 * 機械的なテスト coverage threshold や @graph-* タグ強制は scripts/hooks/* で実施。
 * cortex のような専用 plugin は self-management の規模では不要。
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
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // any 禁止 (unknown を使う)
      "@typescript-eslint/no-explicit-any": "error",
      // console は明示的に使う場合のみ
      "no-console": ["warn", { allow: ["log", "warn", "error"] }],
    },
  },
);
