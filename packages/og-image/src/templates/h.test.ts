/**
 * h() factory のテスト。satori が読む VNode shape を正しく組めるか確認する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business h() factory の単体テスト。children 平坦化 / falsy 除去 / 1 件と複数件の出力形を網羅
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import { h } from "./h.js";

describe("h", () => {
  it("type と style のみで child 無しの VNode", () => {
    expect(h("div", { style: { width: 10 } })).toStrictEqual({
      type: "div",
      props: { style: { width: 10 }, children: undefined },
    });
  });

  it("単一 child は配列に包まずそのまま children に", () => {
    expect(h("span", null, "hello")).toStrictEqual({
      type: "span",
      props: { style: undefined, children: "hello" },
    });
  });

  it("複数 child は配列で children に", () => {
    const out = h("div", null, "a", "b");
    expect(out.props.children).toStrictEqual(["a", "b"]);
  });

  it("ネスト配列 children は flat される", () => {
    const out = h("div", null, ["a", ["b", "c"]] as unknown as string, "d");
    expect(out.props.children).toStrictEqual(["a", "b", "c", "d"]);
  });

  it("null / undefined / false の child は除外される (conditional render 用)", () => {
    const out = h("div", null, "a", null, undefined, false, "b");
    expect(out.props.children).toStrictEqual(["a", "b"]);
  });

  it("全 child が falsy なら children は undefined", () => {
    const out = h("div", null, null, false, undefined);
    expect(out.props.children).toBeUndefined();
  });

  it("ネストした VNode を child に持てる", () => {
    const inner = h("span", { style: { color: "red" } }, "x");
    const outer = h("div", null, inner);
    expect(outer.props.children).toStrictEqual(inner);
  });
});
