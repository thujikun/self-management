/**
 * Primitive design tokens — 全 token system の最下層 (raw values)。
 *
 * - color は **OKLCH** で定義 (人間の知覚に直線的、light/dark で同 step が同 perceived
 *   lightness になるように選んでいる)
 * - space は **0.25rem (4px) base** の harmonic scale
 * - typography は **clamp() ベースの fluid scale**、min/max は viewport の幅依存
 * - motion は ms 値と easing curve、framework 中立
 *
 * 各 step は **数値 key で keyed**。component 側は semantic.ts 経由で参照し、
 * primitive を直接参照するのは theming や semantic 定義の中だけにする。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business design token primitive layer。OKLCH gray (0-1000) + warm accent + 4px base spacing + fluid typography + motion を SSoT として TS で持つ。CSS 出力 (tokens.css) は build-time に css.ts から派生
 * @graph-connects none
 */

/**
 * gray scale (OKLCH)。
 *
 * 0 = pure white、1000 = pure black。50 / 100 / ... / 900 は等知覚距離。
 * neutral background / text / border の primitive。
 *
 * @graph-connects none
 */
export const gray = {
  0: "oklch(100% 0 0)",
  50: "oklch(98.5% 0 0)",
  100: "oklch(96% 0 0)",
  200: "oklch(92% 0 0)",
  300: "oklch(86% 0 0)",
  400: "oklch(74% 0 0)",
  500: "oklch(60% 0 0)",
  600: "oklch(48% 0 0)",
  700: "oklch(36% 0 0)",
  800: "oklch(24% 0 0)",
  900: "oklch(14% 0 0)",
  1000: "oklch(0% 0 0)",
} as const;

/**
 * accent (warm brand) scale。
 *
 * 個人 brand を温かみのある orange-red 系に。chroma を控えめにして "声がデカくない"
 * 落ち着いた warmth を狙う (knife-edge ではなく blanket warmth)。
 * Phase 1 design discovery で hue / chroma を再調整する想定。
 *
 * @graph-connects none
 */
export const accent = {
  50: "oklch(97% 0.015 50)",
  100: "oklch(94% 0.03 50)",
  200: "oklch(88% 0.06 50)",
  300: "oklch(80% 0.1 50)",
  400: "oklch(71% 0.14 50)",
  500: "oklch(63% 0.16 50)",
  600: "oklch(54% 0.16 50)",
  700: "oklch(45% 0.14 50)",
  800: "oklch(36% 0.11 50)",
  900: "oklch(26% 0.07 50)",
} as const;

/**
 * spacing scale (rem)。0.25rem = 4px base、harmonic に伸ばす。
 *
 * @graph-connects none
 */
export const space = {
  0: "0",
  1: "0.25rem", // 4px
  2: "0.5rem", // 8px
  3: "0.75rem", // 12px
  4: "1rem", // 16px
  6: "1.5rem", // 24px
  8: "2rem", // 32px
  12: "3rem", // 48px
  16: "4rem", // 64px
  24: "6rem", // 96px
} as const;

/**
 * border-radius scale。
 *
 * @graph-connects none
 */
export const radius = {
  none: "0",
  sm: "0.25rem", // 4px
  md: "0.5rem", // 8px
  lg: "0.75rem", // 12px
  full: "9999px",
} as const;

/**
 * font family stack。
 *
 * 本文は system serif で読み物らしさを出す。display / UI は system sans。
 * mono は code block 用 (Apple SF Mono / GitHub system stack)。
 *
 * @graph-connects none
 */
export const fontFamily = {
  sans: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", sans-serif',
  serif: '"Iowan Old Style", "Apple Garamond", Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
} as const;

/**
 * fluid type scale (clamp(min, preferred, max))。
 *
 * `preferred` は vw 単位で stretch、`min`/`max` で破綻を抑える。viewport 320–1280
 * 想定でセット。
 *
 * @graph-connects none
 */
export const fontSize = {
  xs: "clamp(0.75rem, 0.7rem + 0.25vw, 0.875rem)", // 12 → 14
  sm: "clamp(0.875rem, 0.825rem + 0.25vw, 1rem)", // 14 → 16
  base: "clamp(1rem, 0.95rem + 0.25vw, 1.125rem)", // 16 → 18
  lg: "clamp(1.125rem, 1.05rem + 0.4vw, 1.375rem)", // 18 → 22
  xl: "clamp(1.375rem, 1.25rem + 0.6vw, 1.75rem)", // 22 → 28
  "2xl": "clamp(1.75rem, 1.5rem + 1vw, 2.5rem)", // 28 → 40
  "3xl": "clamp(2.5rem, 2rem + 2vw, 3.75rem)", // 40 → 60
} as const;

/** @graph-connects none */
export const lineHeight = {
  tight: "1.15",
  snug: "1.35",
  normal: "1.55",
  relaxed: "1.75",
} as const;

/** @graph-connects none */
export const fontWeight = {
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
} as const;

/**
 * blur radius scale。glass morphism / overlay の backdrop-filter 用。
 *
 * @graph-connects none
 */
export const blur = {
  none: "0",
  sm: "4px",
  md: "8px",
  lg: "16px",
  xl: "24px",
} as const;

/**
 * motion duration (ms)。fast = micro-interaction, base = state change, slow = page transition。
 *
 * @graph-connects none
 */
export const duration = {
  instant: "0ms",
  fast: "120ms",
  base: "200ms",
  slow: "320ms",
} as const;

/**
 * motion easing curve。`out` は UI で最頻、`spring` は emphatic interaction、
 * `linear` は continuous (loading bar 等)。
 *
 * @graph-connects none
 */
export const easing = {
  linear: "linear",
  out: "cubic-bezier(0.16, 1, 0.3, 1)",
  inOut: "cubic-bezier(0.65, 0, 0.35, 1)",
  spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
} as const;

/** @graph-connects none */
export type GrayKey = keyof typeof gray;
/** @graph-connects none */
export type AccentKey = keyof typeof accent;
/** @graph-connects none */
export type SpaceKey = keyof typeof space;
/** @graph-connects none */
export type RadiusKey = keyof typeof radius;
/** @graph-connects none */
export type FontFamilyKey = keyof typeof fontFamily;
/** @graph-connects none */
export type FontSizeKey = keyof typeof fontSize;
/** @graph-connects none */
export type LineHeightKey = keyof typeof lineHeight;
/** @graph-connects none */
export type FontWeightKey = keyof typeof fontWeight;
/** @graph-connects none */
export type BlurKey = keyof typeof blur;
/** @graph-connects none */
export type DurationKey = keyof typeof duration;
/** @graph-connects none */
export type EasingKey = keyof typeof easing;
