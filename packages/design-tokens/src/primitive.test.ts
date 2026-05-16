/**
 * primitive token (color / space / radius / typography / motion / blur) の値検証。
 *
 * 全 primitive を **inline snapshot で固定** し、值 (color step / clamp 式 / ms 値)
 * の意図しない変更を機械的に検知する。snapshot は token system の公開契約。
 * scale は数値 step が連続して埋まる構造を `toStrictEqual` でも別途 guard する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business primitive token の不変性保証。各 scale を inline snapshot で固定し token 値の変更を検知、key 集合は toStrictEqual で構造 guard。design discovery で値を更新したら snapshot を `vitest -u` で受け入れる
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

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

describe("color primitives (OKLCH)", () => {
  it("gray scale は 0/50/100/.../900/1000 の連続 step を持つ", () => {
    expect(
      Object.keys(gray)
        .map(Number)
        .sort((a, b) => a - b),
    ).toStrictEqual([0, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
  });

  it("accent scale は 50/100/.../900 の連続 step を持つ", () => {
    expect(
      Object.keys(accent)
        .map(Number)
        .sort((a, b) => a - b),
    ).toStrictEqual([50, 100, 200, 300, 400, 500, 600, 700, 800, 900]);
  });

  it("gray の値全体を snapshot で固定 (chroma=0 / OKLCH 形式)", () => {
    expect(gray).toMatchInlineSnapshot(`
      {
        "0": "oklch(100% 0 0)",
        "100": "oklch(96% 0 0)",
        "1000": "oklch(0% 0 0)",
        "200": "oklch(92% 0 0)",
        "300": "oklch(86% 0 0)",
        "400": "oklch(74% 0 0)",
        "50": "oklch(98.5% 0 0)",
        "500": "oklch(60% 0 0)",
        "600": "oklch(48% 0 0)",
        "700": "oklch(36% 0 0)",
        "800": "oklch(24% 0 0)",
        "900": "oklch(14% 0 0)",
      }
    `);
  });

  it("accent の値全体を snapshot で固定 (warm hue 50)", () => {
    expect(accent).toMatchInlineSnapshot(`
      {
        "100": "oklch(94% 0.03 188)",
        "200": "oklch(88% 0.06 188)",
        "300": "oklch(81% 0.1 188)",
        "400": "oklch(75% 0.12 188)",
        "50": "oklch(97% 0.015 188)",
        "500": "oklch(70% 0.13 188)",
        "600": "oklch(60% 0.13 188)",
        "700": "oklch(50% 0.12 188)",
        "800": "oklch(40% 0.09 188)",
        "900": "oklch(28% 0.06 188)",
      }
    `);
  });
});

describe("spacing / radius / blur primitives", () => {
  it("space scale を snapshot で固定 (0.25rem base harmonic)", () => {
    expect(space).toMatchInlineSnapshot(`
      {
        "0": "0",
        "1": "0.25rem",
        "12": "3rem",
        "16": "4rem",
        "2": "0.5rem",
        "24": "6rem",
        "3": "0.75rem",
        "4": "1rem",
        "6": "1.5rem",
        "8": "2rem",
      }
    `);
  });

  it("radius scale を snapshot で固定", () => {
    expect(radius).toMatchInlineSnapshot(`
      {
        "full": "9999px",
        "lg": "0.75rem",
        "md": "0.5rem",
        "none": "0",
        "sm": "0.25rem",
      }
    `);
  });

  it("blur scale を snapshot で固定", () => {
    expect(blur).toMatchInlineSnapshot(`
      {
        "lg": "16px",
        "md": "8px",
        "none": "0",
        "sm": "4px",
        "xl": "24px",
      }
    `);
  });
});

describe("typography primitives", () => {
  it("fontFamily の値全体を snapshot で固定", () => {
    expect(fontFamily).toMatchInlineSnapshot(`
      {
        "mono": "ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace",
        "sans": ""Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", sans-serif",
        "serif": ""Iowan Old Style", "Apple Garamond", Georgia, "Times New Roman", serif",
      }
    `);
  });

  it("fontSize の値全体を snapshot で固定 (clamp ベース fluid scale)", () => {
    expect(fontSize).toMatchInlineSnapshot(`
      {
        "2xl": "clamp(1.75rem, 1.5rem + 1vw, 2.5rem)",
        "3xl": "clamp(2.5rem, 2rem + 2vw, 3.75rem)",
        "base": "clamp(1rem, 0.95rem + 0.25vw, 1.125rem)",
        "lg": "clamp(1.125rem, 1.05rem + 0.4vw, 1.375rem)",
        "sm": "clamp(0.875rem, 0.825rem + 0.25vw, 1rem)",
        "xl": "clamp(1.375rem, 1.25rem + 0.6vw, 1.75rem)",
        "xs": "clamp(0.75rem, 0.7rem + 0.25vw, 0.875rem)",
      }
    `);
  });

  it("lineHeight を snapshot で固定 (1.0–2.0 の unitless 数値)", () => {
    expect(lineHeight).toMatchInlineSnapshot(`
      {
        "normal": "1.55",
        "relaxed": "1.75",
        "snug": "1.35",
        "tight": "1.15",
      }
    `);
  });

  it("fontWeight を snapshot で固定 (CSS の wght 文字列)", () => {
    expect(fontWeight).toMatchInlineSnapshot(`
      {
        "bold": "700",
        "medium": "500",
        "regular": "400",
        "semibold": "600",
      }
    `);
  });
});

describe("motion primitives", () => {
  it("duration を snapshot で固定 (ms 単位、instant=0)", () => {
    expect(duration).toMatchInlineSnapshot(`
      {
        "base": "200ms",
        "fast": "120ms",
        "instant": "0ms",
        "slow": "320ms",
      }
    `);
  });

  it("easing を snapshot で固定 (linear or cubic-bezier)", () => {
    expect(easing).toMatchInlineSnapshot(`
      {
        "inOut": "cubic-bezier(0.65, 0, 0.35, 1)",
        "linear": "linear",
        "out": "cubic-bezier(0.16, 1, 0.3, 1)",
        "spring": "cubic-bezier(0.34, 1.56, 0.64, 1)",
      }
    `);
  });
});
