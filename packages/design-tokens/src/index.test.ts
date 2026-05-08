/**
 * `@self/design-tokens` の barrel export smoke test。
 *
 * 各 module 個別の挙動は primitive.test.ts / semantic.test.ts / css.test.ts で網羅。
 * ここは re-export が壊れていないこと (型 + 値の到達性) だけ確認する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business barrel export 経路の検証。各 sub-module の中身は専用 test に任せ、ここは index 経由で primitive / semantic / css helper が引けることだけ確認する
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import {
  accent,
  blur,
  buildCss,
  dark,
  duration,
  easing,
  fontFamily,
  fontSize,
  fontWeight,
  gray,
  lineHeight,
  light,
  radius,
  scaleToVars,
  semanticToVars,
  space,
} from "./index.js";

describe("@self/design-tokens barrel exports", () => {
  it("primitive scales (gray / accent / space / radius / typography / motion / blur) が export される", () => {
    expect(gray[0]).toBeDefined();
    expect(accent[500]).toBeDefined();
    expect(space[4]).toBeDefined();
    expect(radius.md).toBeDefined();
    expect(fontFamily.sans).toBeDefined();
    expect(fontSize.base).toBeDefined();
    expect(lineHeight.normal).toBeDefined();
    expect(fontWeight.regular).toBeDefined();
    expect(blur.md).toBeDefined();
    expect(duration.base).toBeDefined();
    expect(easing.out).toBeDefined();
  });

  it("semantic mapping (light / dark) が export される", () => {
    expect(light.bg.base).toBeDefined();
    expect(dark.bg.base).toBeDefined();
    expect(light.bg.base).not.toBe(dark.bg.base);
    expect(light.glass.bg).toBeDefined();
    expect(dark.glass.bg).toBeDefined();
  });

  it("css helper (buildCss / scaleToVars / semanticToVars) が export される", () => {
    expect(typeof buildCss).toBe("function");
    expect(typeof scaleToVars).toBe("function");
    expect(typeof semanticToVars).toBe("function");
  });
});
