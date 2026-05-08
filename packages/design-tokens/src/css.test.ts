/**
 * CSS variable 生成 (`buildCss` / `scaleToVars` / `semanticToVars`) のテスト。
 *
 * 出力は `:root { ... }` + `@media (prefers-color-scheme: dark) { :root { ... } }`
 * の 2 block 構成。primitive と semantic の値が CSS variable として正しく直列化
 * されているかを検証する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business buildCss が primitive と semantic の値を CSS variables 形式に直列化できているか、scale → 行 / semantic → 行への変換が正しいかを検証する。tokens.css の妥当性は本テストが保証する
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import { gray } from "./primitive.js";
import { dark, light } from "./semantic.js";
import { buildCss, scaleToVars, semanticToVars } from "./css.js";

describe("scaleToVars", () => {
  it("`--{prefix}-{key}: value;` 形式で行を生成", () => {
    const lines = scaleToVars("color-gray", { 0: "white", 100: "off" });
    expect(lines).toEqual(["  --color-gray-0: white;", "  --color-gray-100: off;"]);
  });

  it("空 scale なら空 array", () => {
    expect(scaleToVars("x", {})).toEqual([]);
  });
});

describe("semanticToVars", () => {
  it("group + name から `--{group}-{name}: value;` を生成", () => {
    const lines = semanticToVars(light);
    expect(lines).toContain(`  --bg-base: ${light.bg.base};`);
    expect(lines).toContain(`  --text-primary: ${light.text.primary};`);
    expect(lines).toContain(`  --accent-bg: ${light.accent.bg};`);
    expect(lines).toContain(`  --glass-bg: ${light.glass.bg};`);
    expect(lines).toContain(`  --border-default: ${light.border.default};`);
  });

  it("light / dark で同じ key 集合を出力 (順序まで同じ)", () => {
    const l = semanticToVars(light).map((line) => line.split(":")[0]);
    const d = semanticToVars(dark).map((line) => line.split(":")[0]);
    expect(d).toEqual(l);
  });
});

describe("buildCss", () => {
  const css = buildCss();

  it(":root block を含む", () => {
    expect(css).toContain(":root {");
  });

  it("dark theme の @media block を含む", () => {
    expect(css).toContain("@media (prefers-color-scheme: dark)");
  });

  it("primitive (例: gray-0 / gray-1000) を CSS var として出す", () => {
    expect(css).toContain(`--color-gray-0: ${gray[0]};`);
    expect(css).toContain(`--color-gray-1000: ${gray[1000]};`);
  });

  it("semantic (light) を :root block に出す", () => {
    expect(css).toContain(`--bg-base: ${light.bg.base};`);
  });

  it("semantic (dark) を @media block に出す", () => {
    const mediaIdx = css.indexOf("@media (prefers-color-scheme: dark)");
    const tail = css.slice(mediaIdx);
    expect(tail).toContain(`--bg-base: ${dark.bg.base};`);
  });

  it("file 末尾に改行 (POSIX text file 規約)", () => {
    expect(css.endsWith("\n")).toBe(true);
  });
});
