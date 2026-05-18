/**
 * OgTemplate の structural テスト。VNode 構造から brand 要素 / title / footer の
 * 存在 + 色 / fontSize を確認する。実 render (PNG bytes) は generate.test.ts で行う。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business OgTemplate の単体テスト。rt logo / title / tagline / teal accent / dark BG の存在を VNode walk で確認、ascii 以外 (JP) も同じ構造を返すことを assert
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import type { VNode } from "./h.js";
import { OgTemplate, sanitizeOgText } from "./og-template.js";

function flatten(node: VNode | string | undefined): (VNode | string)[] {
  if (node === undefined) return [];
  if (typeof node === "string") return [node];
  const children = node.props.children;
  const arr = Array.isArray(children) ? children : children !== undefined ? [children] : [];
  return [node, ...arr.flatMap((c) => flatten(c))];
}

describe("OgTemplate", () => {
  it("rt logo + title + tagline を含む (EN)", () => {
    const root = OgTemplate({ title: "Hello World" });
    const strings = flatten(root).filter((n): n is string => typeof n === "string");
    expect(strings).toContain("rt");
    expect(strings).toContain("ryantsuji.dev");
    expect(strings).toContain("Hello World");
    expect(strings).toContain("engineering / design / product");
  });

  it("JP タイトル (multi-byte) も同じ構造で含まれる", () => {
    const root = OgTemplate({ title: "社内業務をAIに開放" });
    const strings = flatten(root).filter((n): n is string => typeof n === "string");
    expect(strings).toContain("社内業務をAIに開放");
  });

  it("title は serif で fontSize 64 (brand 強調)", () => {
    const root = OgTemplate({ title: "Hello" });
    const all = flatten(root).filter((n): n is VNode => typeof n !== "string");
    const titleNode = all.find((n) => n.props.style?.fontFamily === "serif");
    expect(titleNode?.props.style?.fontSize).toBe(64);
  });

  it("dark BG (#0c1417) で teal accent (#0abab5) が存在", () => {
    const root = OgTemplate({ title: "x" });
    expect(root.props.style?.backgroundColor).toBe("#0c1417");
    const all = flatten(root).filter((n): n is VNode => typeof n !== "string");
    const tealNode = all.find((n) => n.props.style?.backgroundColor === "#0abab5");
    expect(tealNode).toBeDefined();
  });

  it("Box Drawing block 全域 (U+2500–U+257F) は em-dash に sanitize される (Noto Serif JP の glyph 欠落で tofu になるのを回避)", () => {
    const root = OgTemplate({ title: "前段 ── 後段" });
    const strings = flatten(root).filter((n): n is string => typeof n === "string");
    expect(strings).toContain("前段 —— 後段");
    // sanitize 直接呼びの境界も freeze
    expect(sanitizeOgText("a─b")).toBe("a—b"); // U+2500 LIGHT HORIZONTAL
    expect(sanitizeOgText("──")).toBe("——");
    expect(sanitizeOgText("a-b")).toBe("a-b"); // ASCII hyphen は触らない
    // 同 block の variant glyph (heavy / dashed / vertical) も同じ tofu になるので
    // まとめて置換されること。1 度踏んだ bug を 2 度踏まないための回帰 freeze。
    expect(sanitizeOgText("━─╌┃")).toBe("————"); // U+2501, U+2500, U+254C, U+2503
    // block の両端 (U+2500 / U+257F) も含まれる
    expect(sanitizeOgText("─╿")).toBe("——");
    // block 直前後 (U+24FF / U+2580) は置換しない (U+2580 は Block Elements 側)
    expect(sanitizeOgText("⓿▀")).toBe("⓿▀");
  });

  it("ambient blob 2 つ (左上 + 右下) が radial-gradient で配置される", () => {
    // Arrange: site と同じ ambient blob (左上 accent-bg + 右下 accent-border light)
    // を VNode walk で固定し、誰かが blob を削除 / 移動した時に落ちるようにする。
    const root = OgTemplate({ title: "x" });
    const all = flatten(root).filter((n): n is VNode => typeof n !== "string");

    // Act
    const blobs = all.filter(
      (n) =>
        typeof n.props.style?.backgroundImage === "string" &&
        n.props.style.backgroundImage.startsWith("radial-gradient("),
    );

    // Assert: 2 つ、anchor / size / color / opacity を全部 freeze
    expect(blobs).toHaveLength(2);
    expect(blobs[0].props.style).toStrictEqual({
      position: "absolute",
      top: -360,
      left: -360,
      width: 1080,
      height: 1080,
      backgroundImage: "radial-gradient(closest-side, #0abab5 0%, transparent 70%)",
      opacity: 0.45,
    });
    expect(blobs[1].props.style).toStrictEqual({
      position: "absolute",
      bottom: -300,
      right: -300,
      width: 900,
      height: 900,
      backgroundImage: "radial-gradient(closest-side, #39c4bf 0%, transparent 70%)",
      opacity: 0.32,
    });
  });
});
