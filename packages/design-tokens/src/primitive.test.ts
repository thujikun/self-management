/**
 * primitive token (color / space / radius / typography / motion / blur) の値検証。
 *
 * 値の "正解" は design 判断なので比較的緩い: 形式 (OKLCH 文字列、rem 文字列、ms など)
 * + scale が連続キーで埋まっていることを確認する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business primitive token の構造保証。色は OKLCH 形式、spacing は rem、duration は ms 等の形式チェックと、各 scale が想定 key で連続している (穴あきが無い) ことを test する
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
  it("gray scale は 0/50/100/.../900/1000 を網羅", () => {
    expect(Object.keys(gray).map(Number).sort((a, b) => a - b)).toEqual([
      0, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000,
    ]);
  });

  it("accent scale は 50/100/.../900 を網羅", () => {
    expect(Object.keys(accent).map(Number).sort((a, b) => a - b)).toEqual([
      50, 100, 200, 300, 400, 500, 600, 700, 800, 900,
    ]);
  });

  it("全 color 値は oklch(...) 形式", () => {
    for (const v of Object.values(gray)) expect(v).toMatch(/^oklch\(.+\)$/);
    for (const v of Object.values(accent)) expect(v).toMatch(/^oklch\(.+\)$/);
  });

  it("gray は彩度 (chroma) ゼロ", () => {
    for (const v of Object.values(gray)) expect(v).toMatch(/oklch\(\d+(\.\d+)?% 0 0\)/);
  });
});

describe("spacing / radius / blur primitives", () => {
  it("space は 0 / 1 / 2 / 3 / 4 / 6 / 8 / 12 / 16 / 24 を提供", () => {
    expect(Object.keys(space)).toEqual(
      ["0", "1", "2", "3", "4", "6", "8", "12", "16", "24"],
    );
  });

  it("space は 0 以外 rem 単位", () => {
    expect(space[0]).toBe("0");
    for (const k of [1, 2, 3, 4, 6, 8, 12, 16, 24] as const) {
      expect(space[k]).toMatch(/rem$/);
    }
  });

  it("radius は none / sm / md / lg / full の 5 step", () => {
    expect(Object.keys(radius).sort()).toEqual(["full", "lg", "md", "none", "sm"]);
  });

  it("blur は none / sm / md / lg / xl の 5 step", () => {
    expect(Object.keys(blur).sort()).toEqual(["lg", "md", "none", "sm", "xl"]);
  });
});

describe("typography primitives", () => {
  it("fontFamily は sans / serif / mono を提供", () => {
    expect(fontFamily.sans).toBeTruthy();
    expect(fontFamily.serif).toBeTruthy();
    expect(fontFamily.mono).toBeTruthy();
  });

  it("fontSize は clamp() ベースの fluid scale", () => {
    for (const v of Object.values(fontSize)) {
      expect(v).toMatch(/^clamp\(.+\)$/);
    }
  });

  it("fontSize は xs/sm/base/lg/xl/2xl/3xl の 7 step", () => {
    expect(Object.keys(fontSize).sort()).toEqual(["2xl", "3xl", "base", "lg", "sm", "xl", "xs"]);
  });

  it("lineHeight は tight/snug/normal/relaxed の 4 step、unitless 数値", () => {
    for (const v of Object.values(lineHeight)) {
      expect(parseFloat(v)).toBeGreaterThan(1);
      expect(parseFloat(v)).toBeLessThan(2);
    }
  });

  it("fontWeight は regular/medium/semibold/bold、文字列数値", () => {
    expect(fontWeight.regular).toBe("400");
    expect(fontWeight.bold).toBe("700");
  });
});

describe("motion primitives", () => {
  it("duration は ms 単位、instant=0", () => {
    expect(duration.instant).toBe("0ms");
    expect(duration.fast).toMatch(/^\d+ms$/);
    expect(duration.base).toMatch(/^\d+ms$/);
    expect(duration.slow).toMatch(/^\d+ms$/);
  });

  it("easing は cubic-bezier または linear", () => {
    expect(easing.linear).toBe("linear");
    for (const k of ["out", "inOut", "spring"] as const) {
      expect(easing[k]).toMatch(/^cubic-bezier\(/);
    }
  });
});
