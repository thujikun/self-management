/**
 * `server/i18n.ts` の pickLang helper の network 入力に対する分岐網羅 test。
 *
 * Accept-Language ヘッダーの実例 (browser / external crawler / 不正値) を入れて、
 * `en` / `ja` を期待通り選ぶか、`?lang=` override が常に最優先になるかを確認する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business pickLang の分岐網羅 test。Accept-Language の parsing 正しさ、override の優先順、無効値の en fallback を保証する
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import { isLang, pickLang, SUPPORTED_LANGS } from "./i18n.js";

describe("pickLang", () => {
  it.each([
    ["null", null, "en"],
    ["undefined", undefined, "en"],
    ["empty string", "", "en"],
  ])("Accept-Language が %s なら en fallback", (_label, input, expected) => {
    expect(pickLang(input)).toBe(expected);
  });

  it.each([
    ["ja", "ja"],
    ["ja-JP", "ja"],
    ["ja,en-US;q=0.9,en;q=0.8", "ja"],
    ["JA", "ja"], // case-insensitive
  ])("Accept-Language=%s → ja", (input, expected) => {
    expect(pickLang(input)).toBe(expected);
  });

  it.each([
    ["en", "en"],
    ["en-US", "en"],
    ["en,fr;q=0.8", "en"],
    ["en-US,en;q=0.9", "en"],
  ])("Accept-Language=%s → en", (input, expected) => {
    expect(pickLang(input)).toBe(expected);
  });

  it("先頭の対応 lang が優先される (ja の方が先 → ja)", () => {
    expect(pickLang("ja,en;q=0.5")).toBe("ja");
    expect(pickLang("en,ja;q=0.5")).toBe("en");
  });

  it("未対応 lang のみなら en fallback (e.g. zh)", () => {
    expect(pickLang("zh-CN")).toBe("en");
    expect(pickLang("ko")).toBe("en");
  });

  it("override='en' は Accept-Language を無視して en", () => {
    expect(pickLang("ja", "en")).toBe("en");
    expect(pickLang("zh", "en")).toBe("en");
  });

  it("override='ja' は Accept-Language を無視して ja", () => {
    expect(pickLang("en", "ja")).toBe("ja");
  });

  it.each([
    ["invalid string", "fr"],
    ["null", null],
    ["object", {}],
    ["number", 1],
  ])("override が %s (= 非 Lang) なら Accept-Language fallback に倒れる", (_label, override) => {
    expect(pickLang("ja", override)).toBe("ja");
    expect(pickLang("en", override)).toBe("en");
    expect(pickLang(undefined, override)).toBe("en");
  });
});

describe("isLang", () => {
  it("'en' / 'ja' のみ true", () => {
    expect(isLang("en")).toBe(true);
    expect(isLang("ja")).toBe(true);
  });

  it.each(["", "EN", "ja-JP", null, undefined, {}, 1])("isLang(%s) === false", (input) => {
    expect(isLang(input)).toBe(false);
  });
});

describe("SUPPORTED_LANGS", () => {
  it("`en` と `ja` の 2 件を含む", () => {
    expect(SUPPORTED_LANGS).toEqual(["en", "ja"]);
  });
});
