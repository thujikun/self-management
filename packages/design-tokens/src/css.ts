/**
 * design token を CSS variables 文字列に変換する。
 *
 * primitive.ts / semantic.ts を SSoT として、`tokens.css` を build-time に派生させる。
 * `:root` に primitive + **dark semantic** を、`@media (prefers-color-scheme: light)` で
 * semantic だけを上書きする pattern (primitive は theme で変わらない)。site の baseline
 * は dark で、system が light を選好している場合のみ light に倒れる。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business primitive と semantic を CSS variables 文字列に直列化する pure function 群。tokens.css は本 module の出力を build-time に書き出すだけ、TS 側との drift を防ぐ
 * @graph-connects none
 */

import {
  accent,
  blur,
  duration,
  easing,
  fontFamily,
  fontSize,
  fontWeight,
  gray,
  lineHeight,
  radius,
  space,
} from "./primitive.js";
import { dark, light, type SemanticTokens } from "./semantic.js";

/**
 * scale (例: gray = {0: ..., 50: ...}) を `--{prefix}-{key}: value;` 行に展開。
 *
 * @graph-connects none
 */
export function scaleToVars(prefix: string, scale: Record<string, string>): string[] {
  return Object.entries(scale).map(([k, v]) => `  --${prefix}-${k}: ${v};`);
}

/**
 * semantic を `--{group}-{name}: value;` 行に展開。深さ 2 ({bg: {base: ...}})。
 *
 * @graph-connects none
 */
export function semanticToVars(tokens: SemanticTokens): string[] {
  const out: string[] = [];
  for (const [group, values] of Object.entries(tokens)) {
    for (const [name, value] of Object.entries(values)) {
      out.push(`  --${group}-${name}: ${value};`);
    }
  }
  return out;
}

/**
 * tokens.css 全文を生成。
 *
 * 構成:
 * - `:root` block: 全 primitive + light semantic
 * - `@media (prefers-color-scheme: dark) :root`: cookie 無し時の system default (dark)
 * - `:root[data-theme="dark"]`: cookie で dark を明示 (system が light でも dark を強制)
 * - `:root[data-theme="light"]`: cookie で light を明示 (system が dark でも light を強制)
 *
 * `[data-theme]` 付きの :root selector は specificity (0,1,1) が `:root` (0,0,1) より
 * 高いので、cookie 上書きが system preference より優先される。
 *
 * @graph-connects none
 */
export function buildCss(): string {
  const primitives: string[] = [
    ...scaleToVars("color-gray", gray),
    ...scaleToVars("color-accent", accent),
    ...scaleToVars("space", space),
    ...scaleToVars("radius", radius),
    ...scaleToVars("font-family", fontFamily),
    ...scaleToVars("font-size", fontSize),
    ...scaleToVars("line-height", lineHeight),
    ...scaleToVars("font-weight", fontWeight),
    ...scaleToVars("blur", blur),
    ...scaleToVars("duration", duration),
    ...scaleToVars("easing", easing),
  ];
  const lightSemantic = semanticToVars(light);
  const darkSemantic = semanticToVars(dark);

  return [
    "/**",
    " * @self/design-tokens — generated tokens.css",
    " *",
    " * このファイルは src/css.ts の buildCss() から build-time に生成される。",
    " * 手で編集しない (`pnpm --filter @self/design-tokens build` で再生成)。",
    " */",
    "",
    ":root {",
    ...primitives,
    "",
    "  /* dark theme semantic (default) — site の baseline は dark */",
    ...darkSemantic,
    "}",
    "",
    "/* system prefers light — dark default に対する明示的なオプトアウト */",
    "@media (prefers-color-scheme: light) {",
    "  :root {",
    ...lightSemantic.map((line) => `  ${line}`),
    "  }",
    "}",
    "",
    "/* explicit cookie override: dark (system が light でも適用) */",
    `:root[data-theme="dark"] {`,
    ...darkSemantic,
    "}",
    "",
    "/* explicit cookie override: light (system が dark でも適用) */",
    `:root[data-theme="light"] {`,
    ...lightSemantic,
    "}",
    "",
  ].join("\n");
}
