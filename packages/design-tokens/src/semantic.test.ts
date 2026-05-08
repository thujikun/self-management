/**
 * semantic token (light / dark) の構造 + 整合性検証。
 *
 * - light / dark で同 key 集合を持つ
 * - bg / text / border / accent / glass の 5 系統が揃う
 * - light と dark で同 token name の値が異なる (= 正しく theming で分岐される)
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business semantic mapping の対称性と差分の保証。light/dark で同 token key 集合を持ち、かつ同 key で値が異なる (= 切替で実際に色が変わる) ことを確認する
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import { dark, light } from "./semantic.js";

const GROUPS = ["bg", "text", "border", "accent", "glass"] as const;

describe("semantic tokens — light / dark の構造対称性", () => {
  it("両 theme が同じ top-level group を持つ", () => {
    expect(Object.keys(light).sort()).toEqual([...GROUPS].sort());
    expect(Object.keys(dark).sort()).toEqual([...GROUPS].sort());
  });

  it.each(GROUPS)("group %s が light と dark で同 key 集合", (group) => {
    const l = Object.keys(light[group]).sort();
    const d = Object.keys(dark[group]).sort();
    expect(d).toEqual(l);
  });
});

describe("semantic tokens — light / dark の値差分", () => {
  it("bg.base は light/dark で異なる (主反転)", () => {
    expect(light.bg.base).not.toBe(dark.bg.base);
  });

  it("text.primary も反転", () => {
    expect(light.text.primary).not.toBe(dark.text.primary);
  });

  it("glass.bg も光量 / alpha で異なる", () => {
    expect(light.glass.bg).not.toBe(dark.glass.bg);
  });

  it("glass.blur は両 theme で同じ (blur radius は theme 非依存)", () => {
    expect(light.glass.blur).toBe(dark.glass.blur);
  });
});
