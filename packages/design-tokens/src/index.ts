/**
 * `@self/design-tokens` — ryantsuji.dev の design token SSoT (TypeScript SSoT)。
 *
 * - **primitive**: OKLCH gray / accent + spacing + radius + typography + motion + blur
 * - **semantic**: bg / text / border / accent / glass の 5 系統 (light/dark で同 key で resolve)
 * - **CSS variables**: build-time に `tokens.css` を生成、各 app は `import "@self/design-tokens/css"`
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business design token system の barrel export。primitive scale + semantic mapping + buildCss helper を 1 module から再 export し、TS 側からは型安全に値を引ける + CSS variables ともに使える 2 モード対応の入口
 * @graph-connects none
 */

export {
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
export type {
  AccentKey,
  BlurKey,
  DurationKey,
  EasingKey,
  FontFamilyKey,
  FontSizeKey,
  FontWeightKey,
  GrayKey,
  LineHeightKey,
  RadiusKey,
  SpaceKey,
} from "./primitive.js";

export { dark, light } from "./semantic.js";
export type { SemanticTokens } from "./semantic.js";

export { buildCss, scaleToVars, semanticToVars } from "./css.js";
