/**
 * `server/i18n.ts` の pickLang helper の network 入力に対する分岐網羅 test。
 *
 * Accept-Language ヘッダーの実例 (browser / external crawler / 不正値) を入れて、
 * `en` / `ja` を期待通り選ぶか、`?lang=` override が常に最優先になるか、cookie
 * が Accept-Language より優先されるかを確認する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business pickLang の分岐網羅 test。override > cookie > Accept-Language > en fallback の 4 段優先を全パターン踏み、無効値や境界 (空文字 / null) も網羅する
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import {
  buildLangSetCookie,
  isLang,
  LANG_COOKIE,
  LANG_COOKIE_MAX_AGE,
  parseLangCookie,
  pickLang,
  SUPPORTED_LANGS,
} from "./i18n.js";

describe("pickLang", () => {
  it.each([
    ["null", null, "en"],
    ["undefined", undefined, "en"],
    ["empty string", "", "en"],
  ])("Accept-Language が %s なら en fallback", (_label, acceptLanguage, expected) => {
    expect(pickLang({ acceptLanguage: acceptLanguage as string | null | undefined })).toBe(
      expected,
    );
  });

  it.each([
    ["ja", "ja"],
    ["ja-JP", "ja"],
    ["ja,en-US;q=0.9,en;q=0.8", "ja"],
    ["JA", "ja"], // case-insensitive
  ])("Accept-Language=%s → ja", (acceptLanguage, expected) => {
    expect(pickLang({ acceptLanguage })).toBe(expected);
  });

  it.each([
    ["en", "en"],
    ["en-US", "en"],
    ["en,fr;q=0.8", "en"],
    ["en-US,en;q=0.9", "en"],
  ])("Accept-Language=%s → en", (acceptLanguage, expected) => {
    expect(pickLang({ acceptLanguage })).toBe(expected);
  });

  it("先頭の対応 lang が優先される (ja の方が先 → ja)", () => {
    expect(pickLang({ acceptLanguage: "ja,en;q=0.5" })).toBe("ja");
    expect(pickLang({ acceptLanguage: "en,ja;q=0.5" })).toBe("en");
  });

  it("未対応 lang のみなら en fallback (e.g. zh)", () => {
    expect(pickLang({ acceptLanguage: "zh-CN" })).toBe("en");
    expect(pickLang({ acceptLanguage: "ko" })).toBe("en");
  });

  it("override='en' は Accept-Language を無視して en", () => {
    expect(pickLang({ override: "en", acceptLanguage: "ja" })).toBe("en");
    expect(pickLang({ override: "en", acceptLanguage: "zh" })).toBe("en");
  });

  it("override='ja' は Accept-Language を無視して ja", () => {
    expect(pickLang({ override: "ja", acceptLanguage: "en" })).toBe("ja");
  });

  it.each([
    ["invalid string", "fr"],
    ["null", null],
    ["object", {}],
    ["number", 1],
  ])(
    "override が %s (= 非 Lang) なら cookie / Accept-Language fallback に倒れる",
    (_label, override) => {
      expect(pickLang({ override, acceptLanguage: "ja" })).toBe("ja");
      expect(pickLang({ override, acceptLanguage: "en" })).toBe("en");
      expect(pickLang({ override, acceptLanguage: undefined })).toBe("en");
    },
  );

  it("cookie は Accept-Language より優先される (override 無し時)", () => {
    expect(pickLang({ cookieLang: "ja", acceptLanguage: "en" })).toBe("ja");
    expect(pickLang({ cookieLang: "en", acceptLanguage: "ja" })).toBe("en");
  });

  it("override は cookie より優先される", () => {
    expect(pickLang({ override: "en", cookieLang: "ja", acceptLanguage: "ja" })).toBe("en");
    expect(pickLang({ override: "ja", cookieLang: "en", acceptLanguage: "en" })).toBe("ja");
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

describe("parseLangCookie", () => {
  it("null / undefined / 空文字は null", () => {
    expect(parseLangCookie(null)).toBeNull();
    expect(parseLangCookie(undefined)).toBeNull();
    expect(parseLangCookie("")).toBeNull();
  });

  it("`ryantsuji_lang=ja` を抽出", () => {
    expect(parseLangCookie("ryantsuji_lang=ja")).toBe("ja");
  });

  it("`ryantsuji_lang=en` を抽出", () => {
    expect(parseLangCookie("ryantsuji_lang=en")).toBe("en");
  });

  it("複数 cookie が並んでも対象を取り出す", () => {
    expect(parseLangCookie("foo=bar; ryantsuji_lang=ja; baz=qux")).toBe("ja");
  });

  it("空白に robust", () => {
    expect(parseLangCookie(" ryantsuji_lang = ja ")).toBe("ja");
  });

  it("invalid 値 (`fr` 等) は null", () => {
    expect(parseLangCookie("ryantsuji_lang=fr")).toBeNull();
    expect(parseLangCookie("ryantsuji_lang=")).toBeNull();
  });

  it("`=` を含まない segment は skip", () => {
    expect(parseLangCookie("flag; ryantsuji_lang=ja")).toBe("ja");
  });

  it("該当 cookie 名が無ければ null", () => {
    expect(parseLangCookie("foo=ja; bar=en")).toBeNull();
  });
});

describe("buildLangSetCookie", () => {
  it("Path=/ + Max-Age + SameSite=Lax を含む", () => {
    const value = buildLangSetCookie("ja");
    expect(value).toBe(`${LANG_COOKIE}=ja; Path=/; Max-Age=${LANG_COOKIE_MAX_AGE}; SameSite=Lax`);
  });

  it("EN / JA とも同じ format", () => {
    expect(buildLangSetCookie("en")).toContain("ryantsuji_lang=en");
    expect(buildLangSetCookie("ja")).toContain("ryantsuji_lang=ja");
  });
});

describe("constants", () => {
  it("LANG_COOKIE 名は `ryantsuji_lang`", () => {
    expect(LANG_COOKIE).toBe("ryantsuji_lang");
  });

  it("LANG_COOKIE_MAX_AGE は 1 年 (秒)", () => {
    expect(LANG_COOKIE_MAX_AGE).toBe(60 * 60 * 24 * 365);
  });
});
