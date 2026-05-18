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
 * 引数なしの場合は repo 内の全 authored `.css` を対象とする (CI full-mode 想定)。
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business CSS custom property 参照の整合性 check の CLI thin entry。staged file から `.css` だけ拾って checkCssTokens に流し、未宣言 token への参照を 1 件でも検出したら exit 1 で commit を止める
 * @graph-connects none
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import { DEFAULT_DYNAMIC_PREFIXES, checkCssTokens } from "./check-css-tokens.js";

// declaration sources は **常に固定**:
// - 該当 css file 自身 (`:root` / `@theme` block の宣言を拾う)
// - `packages/design-tokens/dist/tokens.css` (= semantic / primitive tokens の SoT)
// 追加 source が必要になったらここに 1 行足す。
const DESIGN_TOKENS_CSS = "packages/design-tokens/dist/tokens.css";

function main(): void {
  const args = process.argv.slice(2);
  const targets = args.filter((a) => a.endsWith(".css"));
  if (targets.length === 0) {
    // 引数なし or `.css` が含まれない → 何もチェックせず exit 0 (staged mode で
    // .css 変更が無いコミットは通す)。
    return;
  }

  const declarationSources: Array<{ file: string; content: string }> = [];

  // 1. design-tokens dist
  const tokensPath = resolve(DESIGN_TOKENS_CSS);
  if (existsSync(tokensPath)) {
    declarationSources.push({ file: DESIGN_TOKENS_CSS, content: readFileSync(tokensPath, "utf8") });
  }

  // 2. 引数の css file 自身も declaration source として読み込む
  //    (file 内で完結した自前 declaration `:root { --x: 1px }` 等を拾うため)
  const referenceSources: Array<{ file: string; content: string }> = [];
  for (const t of targets) {
    const abs = resolve(t);
    if (!existsSync(abs)) continue;
    const content = readFileSync(abs, "utf8");
    declarationSources.push({ file: t, content });
    referenceSources.push({ file: t, content });
  }

  const violations = checkCssTokens({
    declarationSources,
    referenceSources,
    dynamicPrefixes: DEFAULT_DYNAMIC_PREFIXES,
  });

  if (violations.length === 0) {
    return;
  }

  console.error("✗ check-css-tokens: undefined CSS custom property reference(s) found:\n");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  var(${v.token})  ← not declared`);
  }
  console.error(
    "\n  fix: 有効な token に置換するか、`packages/design-tokens` の semantic token に追加",
  );
  console.error(
    "       (runtime に inject される `--tw-*` / `--shiki-*` 等は cli の dynamicPrefixes に追加)",
  );
  process.exit(1);
}

main();
