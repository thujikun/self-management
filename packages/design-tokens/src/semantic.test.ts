/**
 * semantic token (light / dark) の構造 + 値検証。
 *
 * 両 theme の全 token 値を inline snapshot で固定し、theming 切替時の意図しない
 * 変化を機械的に検知する。`Object.keys` 比較で light/dark の構造対称性も別途 guard。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business semantic mapping を inline snapshot で固定し、light/dark 切替時の値ドリフトを検知する。primitive 値に依存して導出されるため snapshot で full mapping を凍結する形が後で戻りやすい
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import { dark, light } from "./semantic.js";

describe("semantic tokens — 構造対称性", () => {
  it("light / dark は同じ top-level group を持つ", () => {
    expect(Object.keys(dark).sort()).toStrictEqual(Object.keys(light).sort());
  });

  it("各 group で light / dark が同じ key 集合", () => {
    for (const group of Object.keys(light) as Array<keyof typeof light>) {
      expect(Object.keys(dark[group]).sort()).toStrictEqual(Object.keys(light[group]).sort());
    }
  });
});

describe("semantic tokens — light theme", () => {
  it("light の値全体を snapshot で固定", () => {
    expect(light).toMatchInlineSnapshot(`
      {
        "accent": {
          "bg": "oklch(60% 0.13 188)",
          "border": "oklch(70% 0.13 188)",
          "fg": "oklch(100% 0 0)",
        },
        "bg": {
          "base": "oklch(100% 0 0)",
          "elevated": "oklch(96% 0 0)",
          "surface": "oklch(98.5% 0 0)",
        },
        "border": {
          "default": "oklch(92% 0 0)",
          "strong": "oklch(74% 0 0)",
          "subtle": "oklch(96% 0 0)",
        },
        "glass": {
          "bg": "oklch(100% 0 0 / 0.45)",
          "blur": "24px",
          "border": "oklch(0% 0 0 / 0.06)",
        },
        "text": {
          "accent": "oklch(50% 0.12 188)",
          "muted": "oklch(60% 0 0)",
          "primary": "oklch(14% 0 0)",
          "secondary": "oklch(36% 0 0)",
        },
      }
    `);
  });
});

describe("semantic tokens — dark theme", () => {
  it("dark の値全体を snapshot で固定", () => {
    expect(dark).toMatchInlineSnapshot(`
      {
        "accent": {
          "bg": "oklch(70% 0.13 188)",
          "border": "oklch(75% 0.12 188)",
          "fg": "oklch(14% 0 0)",
        },
        "bg": {
          "base": "oklch(17% 0.018 188)",
          "elevated": "oklch(28% 0.01 188)",
          "surface": "oklch(22% 0.014 188)",
        },
        "border": {
          "default": "oklch(30% 0.012 188)",
          "strong": "oklch(60% 0 0)",
          "subtle": "oklch(22% 0.014 188)",
        },
        "glass": {
          "bg": "oklch(22% 0.02 188 / 0.4)",
          "blur": "24px",
          "border": "oklch(100% 0 0 / 0.08)",
        },
        "text": {
          "accent": "oklch(81% 0.1 188)",
          "muted": "oklch(74% 0 0)",
          "primary": "oklch(98.5% 0 0)",
          "secondary": "oklch(92% 0 0)",
        },
      }
    `);
  });
});

describe("semantic tokens — light/dark の差分", () => {
  it("bg.base: light は白、dark は黒寄りで極弱 teal tint", () => {
    expect(light.bg.base).toMatch(/100%/);
    expect(dark.bg.base).toMatch(/17%/);
  });

  it("glass.blur は両 theme で同じ (blur radius は theme 非依存)", () => {
    expect(dark.glass.blur).toStrictEqual(light.glass.blur);
  });
});
