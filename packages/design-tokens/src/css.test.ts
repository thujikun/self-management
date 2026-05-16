/**
 * CSS variable 生成 (`buildCss` / `scaleToVars` / `semanticToVars`) のテスト。
 *
 * - `scaleToVars` / `semanticToVars` は pure function なので入出力を `toStrictEqual`
 *   で固定
 * - `buildCss` は output が長いので **full output を inline snapshot で固定**。
 *   primitive / semantic の値が変われば snapshot が落ち、`vitest -u` で更新する運用
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business CSS 直列化 helper の不変性保証。scaleToVars / semanticToVars は pure 関数として toStrictEqual、buildCss は出力全体を inline snapshot で固定し token / 出力フォーマット双方の変更検知を mechanically に行う
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import { buildCss, scaleToVars, semanticToVars } from "./css.js";
import { dark, light } from "./semantic.js";

describe("scaleToVars", () => {
  it("`--{prefix}-{key}: value;` 行を生成", () => {
    expect(scaleToVars("color-gray", { 0: "white", 100: "off" })).toStrictEqual([
      "  --color-gray-0: white;",
      "  --color-gray-100: off;",
    ]);
  });

  it("空 scale なら空 array", () => {
    expect(scaleToVars("x", {})).toStrictEqual([]);
  });
});

describe("semanticToVars", () => {
  it("light の output 全体を snapshot で固定", () => {
    expect(semanticToVars(light)).toMatchInlineSnapshot(`
      [
        "  --bg-base: oklch(100% 0 0);",
        "  --bg-surface: oklch(98.5% 0 0);",
        "  --bg-elevated: oklch(96% 0 0);",
        "  --text-primary: oklch(14% 0 0);",
        "  --text-secondary: oklch(36% 0 0);",
        "  --text-muted: oklch(60% 0 0);",
        "  --text-accent: oklch(50% 0.12 188);",
        "  --border-subtle: oklch(96% 0 0);",
        "  --border-default: oklch(92% 0 0);",
        "  --border-strong: oklch(74% 0 0);",
        "  --accent-bg: oklch(60% 0.13 188);",
        "  --accent-fg: oklch(100% 0 0);",
        "  --accent-border: oklch(70% 0.13 188);",
        "  --glass-bg: oklch(100% 0 0 / 0.65);",
        "  --glass-border: oklch(0% 0 0 / 0.06);",
        "  --glass-blur: 16px;",
      ]
    `);
  });

  it("dark の output 全体を snapshot で固定", () => {
    expect(semanticToVars(dark)).toMatchInlineSnapshot(`
      [
        "  --bg-base: oklch(17% 0.018 188);",
        "  --bg-surface: oklch(22% 0.014 188);",
        "  --bg-elevated: oklch(28% 0.01 188);",
        "  --text-primary: oklch(98.5% 0 0);",
        "  --text-secondary: oklch(92% 0 0);",
        "  --text-muted: oklch(74% 0 0);",
        "  --text-accent: oklch(81% 0.1 188);",
        "  --border-subtle: oklch(22% 0.014 188);",
        "  --border-default: oklch(30% 0.012 188);",
        "  --border-strong: oklch(60% 0 0);",
        "  --accent-bg: oklch(70% 0.13 188);",
        "  --accent-fg: oklch(14% 0 0);",
        "  --accent-border: oklch(75% 0.12 188);",
        "  --glass-bg: oklch(24% 0.02 188 / 0.55);",
        "  --glass-border: oklch(100% 0 0 / 0.08);",
        "  --glass-blur: 16px;",
      ]
    `);
  });

  it("light / dark は同じ var name 順序で出る (theming で値だけ差替えるため)", () => {
    const lNames = semanticToVars(light).map((line) => line.split(":")[0]);
    const dNames = semanticToVars(dark).map((line) => line.split(":")[0]);
    expect(dNames).toStrictEqual(lNames);
  });
});

describe("buildCss", () => {
  it("output 全体を inline snapshot で固定 (:root + dark @media block)", () => {
    expect(buildCss()).toMatchInlineSnapshot(`
      "/**
       * @self/design-tokens — generated tokens.css
       *
       * このファイルは src/css.ts の buildCss() から build-time に生成される。
       * 手で編集しない (\`pnpm --filter @self/design-tokens build\` で再生成)。
       */

      :root {
        --color-gray-0: oklch(100% 0 0);
        --color-gray-50: oklch(98.5% 0 0);
        --color-gray-100: oklch(96% 0 0);
        --color-gray-200: oklch(92% 0 0);
        --color-gray-300: oklch(86% 0 0);
        --color-gray-400: oklch(74% 0 0);
        --color-gray-500: oklch(60% 0 0);
        --color-gray-600: oklch(48% 0 0);
        --color-gray-700: oklch(36% 0 0);
        --color-gray-800: oklch(24% 0 0);
        --color-gray-900: oklch(14% 0 0);
        --color-gray-1000: oklch(0% 0 0);
        --color-accent-50: oklch(97% 0.015 188);
        --color-accent-100: oklch(94% 0.03 188);
        --color-accent-200: oklch(88% 0.06 188);
        --color-accent-300: oklch(81% 0.1 188);
        --color-accent-400: oklch(75% 0.12 188);
        --color-accent-500: oklch(70% 0.13 188);
        --color-accent-600: oklch(60% 0.13 188);
        --color-accent-700: oklch(50% 0.12 188);
        --color-accent-800: oklch(40% 0.09 188);
        --color-accent-900: oklch(28% 0.06 188);
        --space-0: 0;
        --space-1: 0.25rem;
        --space-2: 0.5rem;
        --space-3: 0.75rem;
        --space-4: 1rem;
        --space-6: 1.5rem;
        --space-8: 2rem;
        --space-12: 3rem;
        --space-16: 4rem;
        --space-24: 6rem;
        --radius-none: 0;
        --radius-sm: 0.25rem;
        --radius-md: 0.5rem;
        --radius-lg: 0.75rem;
        --radius-full: 9999px;
        --font-family-sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", sans-serif;
        --font-family-serif: "Iowan Old Style", "Apple Garamond", Georgia, "Times New Roman", serif;
        --font-family-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
        --font-size-xs: clamp(0.75rem, 0.7rem + 0.25vw, 0.875rem);
        --font-size-sm: clamp(0.875rem, 0.825rem + 0.25vw, 1rem);
        --font-size-base: clamp(1rem, 0.95rem + 0.25vw, 1.125rem);
        --font-size-lg: clamp(1.125rem, 1.05rem + 0.4vw, 1.375rem);
        --font-size-xl: clamp(1.375rem, 1.25rem + 0.6vw, 1.75rem);
        --font-size-2xl: clamp(1.75rem, 1.5rem + 1vw, 2.5rem);
        --font-size-3xl: clamp(2.5rem, 2rem + 2vw, 3.75rem);
        --line-height-tight: 1.15;
        --line-height-snug: 1.35;
        --line-height-normal: 1.55;
        --line-height-relaxed: 1.75;
        --font-weight-regular: 400;
        --font-weight-medium: 500;
        --font-weight-semibold: 600;
        --font-weight-bold: 700;
        --blur-none: 0;
        --blur-sm: 4px;
        --blur-md: 8px;
        --blur-lg: 16px;
        --blur-xl: 24px;
        --blur-ambient: 80px;
        --duration-instant: 0ms;
        --duration-fast: 120ms;
        --duration-base: 200ms;
        --duration-slow: 320ms;
        --easing-linear: linear;
        --easing-out: cubic-bezier(0.16, 1, 0.3, 1);
        --easing-inOut: cubic-bezier(0.65, 0, 0.35, 1);
        --easing-spring: cubic-bezier(0.34, 1.56, 0.64, 1);

        /* light theme semantic (default) */
        --bg-base: oklch(100% 0 0);
        --bg-surface: oklch(98.5% 0 0);
        --bg-elevated: oklch(96% 0 0);
        --text-primary: oklch(14% 0 0);
        --text-secondary: oklch(36% 0 0);
        --text-muted: oklch(60% 0 0);
        --text-accent: oklch(50% 0.12 188);
        --border-subtle: oklch(96% 0 0);
        --border-default: oklch(92% 0 0);
        --border-strong: oklch(74% 0 0);
        --accent-bg: oklch(60% 0.13 188);
        --accent-fg: oklch(100% 0 0);
        --accent-border: oklch(70% 0.13 188);
        --glass-bg: oklch(100% 0 0 / 0.65);
        --glass-border: oklch(0% 0 0 / 0.06);
        --glass-blur: 16px;
      }

      /* system prefers dark — cookie 未設定時の自然な default */
      @media (prefers-color-scheme: dark) {
        :root {
          --bg-base: oklch(17% 0.018 188);
          --bg-surface: oklch(22% 0.014 188);
          --bg-elevated: oklch(28% 0.01 188);
          --text-primary: oklch(98.5% 0 0);
          --text-secondary: oklch(92% 0 0);
          --text-muted: oklch(74% 0 0);
          --text-accent: oklch(81% 0.1 188);
          --border-subtle: oklch(22% 0.014 188);
          --border-default: oklch(30% 0.012 188);
          --border-strong: oklch(60% 0 0);
          --accent-bg: oklch(70% 0.13 188);
          --accent-fg: oklch(14% 0 0);
          --accent-border: oklch(75% 0.12 188);
          --glass-bg: oklch(24% 0.02 188 / 0.55);
          --glass-border: oklch(100% 0 0 / 0.08);
          --glass-blur: 16px;
        }
      }

      /* explicit cookie override: dark (system が light でも適用) */
      :root[data-theme="dark"] {
        --bg-base: oklch(17% 0.018 188);
        --bg-surface: oklch(22% 0.014 188);
        --bg-elevated: oklch(28% 0.01 188);
        --text-primary: oklch(98.5% 0 0);
        --text-secondary: oklch(92% 0 0);
        --text-muted: oklch(74% 0 0);
        --text-accent: oklch(81% 0.1 188);
        --border-subtle: oklch(22% 0.014 188);
        --border-default: oklch(30% 0.012 188);
        --border-strong: oklch(60% 0 0);
        --accent-bg: oklch(70% 0.13 188);
        --accent-fg: oklch(14% 0 0);
        --accent-border: oklch(75% 0.12 188);
        --glass-bg: oklch(24% 0.02 188 / 0.55);
        --glass-border: oklch(100% 0 0 / 0.08);
        --glass-blur: 16px;
      }

      /* explicit cookie override: light (system が dark でも適用) */
      :root[data-theme="light"] {
        --bg-base: oklch(100% 0 0);
        --bg-surface: oklch(98.5% 0 0);
        --bg-elevated: oklch(96% 0 0);
        --text-primary: oklch(14% 0 0);
        --text-secondary: oklch(36% 0 0);
        --text-muted: oklch(60% 0 0);
        --text-accent: oklch(50% 0.12 188);
        --border-subtle: oklch(96% 0 0);
        --border-default: oklch(92% 0 0);
        --border-strong: oklch(74% 0 0);
        --accent-bg: oklch(60% 0.13 188);
        --accent-fg: oklch(100% 0 0);
        --accent-border: oklch(70% 0.13 188);
        --glass-bg: oklch(100% 0 0 / 0.65);
        --glass-border: oklch(0% 0 0 / 0.06);
        --glass-blur: 16px;
      }
      "
    `);
  });
});
