#!/usr/bin/env tsx
/**
 * check-css-tokens CLI thin entry。`gates.sh` (pre-commit / CI) から呼ばれ、
 * staged な `.css` ファイルに含まれる `var(--name)` 参照のうち、design-tokens dist /
 * 該当 css 自身 / 他 source の何にも宣言が無いものを violation として print し、
 * 1 件でもあれば exit 1。
 *
 * 使い方:
 *   pnpm exec tsx scripts/hooks/check-css-tokens.cli.ts <css-file> [<css-file> ...]
 *
 * 引数なし or `.css` を含まない場合は何も check せず exit 0。orchestration / fs IO は
 * `runCheckCssTokens` に集約 (test 容易性のため、本 cli は process bridge のみ)。
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business CSS custom property 参照の整合性 check の CLI thin entry。runCheckCssTokens を呼んで stderr を流し exit code を返すだけ。design-tokens dist 不在は fail-fast (silent skip しない) で pre-commit と CI の drift を防ぐ
 * @graph-connects ./check-css-tokens [calls] runCheckCssTokens で orchestration を実行
 */

import { runCheckCssTokens } from "./check-css-tokens.js";

// declaration source は **常に固定**:
// - 該当 css file 自身 (`:root` / `@theme` block の宣言を拾う)
// - `packages/design-tokens/dist/tokens.css` (= semantic / primitive tokens の SoT)
// 追加 source が必要になったらここに 1 行足す。
const DESIGN_TOKENS_CSS = "packages/design-tokens/dist/tokens.css";

const result = runCheckCssTokens({
  args: process.argv.slice(2),
  designTokensCssPath: DESIGN_TOKENS_CSS,
});
if (result.stderr.length > 0) {
  console.error(result.stderr.join("\n"));
}
if (result.exitCode !== 0) {
  process.exit(result.exitCode);
}
