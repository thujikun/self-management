/**
 * `server/theme.ts` の helper の分岐網羅 test。i18n.ts と並列で、cookie 解析 +
 * pickTheme の resolution 順 (cookie 明示 → null) を踏み分ける。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business theme cookie 解析と pickTheme の分岐網羅。invalid 値の reject、cookie 未設定で null 返す経路、isTheme の TypeGuard を全パターン
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import {
  isTheme,
  parseThemeCookie,
  pickTheme,
  SUPPORTED_THEMES,
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
} from "./theme.js";

describe("isTheme", () => {
  it("'light' / 'dark' のみ true", () => {
    expect(isTheme("light")).toBe(true);
    expect(isTheme("dark")).toBe(true);
  });

  it.each(["", "LIGHT", "Dark", null, undefined, {}, 1, "auto"])(
    "isTheme(%s) === false",
    (input) => {
      expect(isTheme(input)).toBe(false);
    },
  );
});

describe("parseThemeCookie", () => {
  it("null / undefined / 空文字は null", () => {
    expect(parseThemeCookie(null)).toBeNull();
    expect(parseThemeCookie(undefined)).toBeNull();
    expect(parseThemeCookie("")).toBeNull();
  });

  it("`ryantsuji_theme=light` から light を抽出", () => {
    expect(parseThemeCookie("ryantsuji_theme=light")).toBe("light");
  });

  it("`ryantsuji_theme=dark` から dark を抽出", () => {
    expect(parseThemeCookie("ryantsuji_theme=dark")).toBe("dark");
  });

  it("複数 cookie が並んでも `ryantsuji_theme` を取り出す", () => {
    expect(parseThemeCookie("foo=bar; ryantsuji_theme=dark; baz=qux")).toBe("dark");
  });

  it("空白に robust (`a = 1; b = 2`)", () => {
    expect(parseThemeCookie(" ryantsuji_theme = light ")).toBe("light");
  });

  it("該当 cookie 値が Theme として invalid なら null (`auto` 等)", () => {
    expect(parseThemeCookie("ryantsuji_theme=auto")).toBeNull();
    expect(parseThemeCookie("ryantsuji_theme=")).toBeNull();
  });

  it("`=` を含まない segment は skip", () => {
    expect(parseThemeCookie("flag; ryantsuji_theme=dark")).toBe("dark");
  });

  it("該当 cookie 名が無ければ null", () => {
    expect(parseThemeCookie("foo=light; bar=dark")).toBeNull();
  });
});

describe("pickTheme", () => {
  it("cookie 明示 'light' → light", () => {
    expect(pickTheme({ cookieTheme: "light" })).toBe("light");
  });

  it("cookie 明示 'dark' → dark", () => {
    expect(pickTheme({ cookieTheme: "dark" })).toBe("dark");
  });

  it("cookie null → null (system default に委ねる)", () => {
    expect(pickTheme({ cookieTheme: null })).toBeNull();
  });

  it("cookie undefined → null", () => {
    expect(pickTheme({})).toBeNull();
  });
});

describe("constants", () => {
  it("SUPPORTED_THEMES は light/dark の 2 件", () => {
    expect(SUPPORTED_THEMES).toEqual(["light", "dark"]);
  });

  it("THEME_COOKIE 名は `ryantsuji_theme`", () => {
    expect(THEME_COOKIE).toBe("ryantsuji_theme");
  });

  it("THEME_COOKIE_MAX_AGE は 1 年 (秒)", () => {
    expect(THEME_COOKIE_MAX_AGE).toBe(60 * 60 * 24 * 365);
  });
});
