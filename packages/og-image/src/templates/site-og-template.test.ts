/**
 * SiteOgTemplate の structural テスト。VNode walk で center logo / tagline /
 * dark BG / ambient blob を assert する。実 render (PNG) は generate 経由で行う。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business SiteOgTemplate (`public/og-image.png` 用) の単体テスト。中央 rt logo + ryantsuji.dev + tagline + ambient blob 2 個 + dark BG を VNode walk で freeze し、サイト全体 og:image の brand spec を壊さないようにする
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import type { VNode } from "./h.js";
import { SiteOgTemplate } from "./site-og-template.js";

function flatten(node: VNode | string | undefined): (VNode | string)[] {
  if (node === undefined) return [];
  if (typeof node === "string") return [node];
  const children = node.props.children;
  const arr = Array.isArray(children) ? children : children !== undefined ? [children] : [];
  return [node, ...arr.flatMap((c) => flatten(c))];
}

describe("SiteOgTemplate", () => {
  it("中央 rt logo + ryantsuji.dev + tagline を含む", () => {
    const root = SiteOgTemplate();
    const strings = flatten(root).filter((n): n is string => typeof n === "string");
    expect(strings).toContain("rt");
    expect(strings).toContain("ryantsuji.dev");
    expect(strings).toContain("engineering / design / product");
  });

  it("rt logo は fontSize 280 / teal (#0abab5) (brand-forward)", () => {
    const root = SiteOgTemplate();
    const all = flatten(root).filter((n): n is VNode => typeof n !== "string");
    const rtNode = all.find(
      (n) => n.props.style?.fontSize === 280 && n.props.style?.color === "#0abab5",
    );
    expect(rtNode).toBeDefined();
  });

  it("dark BG (#0c1417) + ambient blob 2 つ (post 用と同じ spec)", () => {
    const root = SiteOgTemplate();
    expect(root.props.style?.backgroundColor).toBe("#0c1417");
    const all = flatten(root).filter((n): n is VNode => typeof n !== "string");
    const blobs = all.filter(
      (n) =>
        typeof n.props.style?.backgroundImage === "string" &&
        n.props.style.backgroundImage.startsWith("radial-gradient("),
    );
    expect(blobs).toHaveLength(2);
  });
});
