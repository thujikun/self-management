/**
 * `appendFooter` の境界網羅。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business footer append 関数の境界 test。null / 空 / 改行ありなし / 二重改行の正規化を網羅
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import { appendFooter } from "./footer.js";

describe("appendFooter", () => {
  it("null footer は body そのまま", () => {
    expect(appendFooter("本文\n", null)).toBe("本文\n");
  });

  it("空文字 / whitespace のみ footer は body そのまま", () => {
    expect(appendFooter("本文", "")).toBe("本文");
    expect(appendFooter("本文", "   \n  \n")).toBe("本文");
  });

  it("通常の footer は body 末尾に空行 1 つ + footer + 末尾改行で append", () => {
    const out = appendFooter("本文", "採用中");
    expect(out).toBe("本文\n\n採用中\n");
  });

  it("body 末尾の余分な改行は除去し空行 1 つに正規化", () => {
    const out = appendFooter("本文\n\n\n", "採用中");
    expect(out).toBe("本文\n\n採用中\n");
  });

  it("footer 前後の改行 / whitespace は除去", () => {
    const out = appendFooter("本文", "\n\n採用中\n\n");
    expect(out).toBe("本文\n\n採用中\n");
  });

  it("multi-line footer も改行を保ったまま append", () => {
    const footer = "---\n\n採用中。\n[link](https://example.com)";
    const out = appendFooter("本文", footer);
    expect(out).toBe("本文\n\n---\n\n採用中。\n[link](https://example.com)\n");
  });
});
