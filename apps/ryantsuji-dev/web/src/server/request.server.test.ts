/**
 * `server/request.server.ts` の cookie / Accept-Language helper の分岐網羅 test。
 *
 * `getRequestHeaders` / `getCookie` / `setCookie` を `vi.mock` で差し替え、
 * 成功 / undefined / throw / invalid の各経路を踏む。これにより SoT 化した helper の
 * 挙動を route 側 test と独立に保証できる。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business safeAcceptLanguage / safeCookieLang / writeLangCookie / safeCookieTheme / writeThemeCookie の分岐網羅 test。getRequestHeaders / getCookie / setCookie が throw する test runtime でも catch して fallback する経路を踏む
 * @graph-connects none
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetRequestHeaders = vi.fn<() => Record<string, string | undefined>>();
const mockGetCookie = vi.fn<(name: string) => string | undefined>();
const mockSetCookie =
  vi.fn<(name: string, value: string, options: Record<string, unknown>) => void>();

vi.mock("@tanstack/react-start/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start/server")>();
  return {
    ...actual,
    getRequestHeaders: () => mockGetRequestHeaders(),
    getCookie: (name: string) => mockGetCookie(name),
    setCookie: (name: string, value: string, options: Record<string, unknown>) =>
      mockSetCookie(name, value, options),
  };
});

import {
  safeAcceptLanguage,
  safeCookieLang,
  safeCookieTheme,
  writeLangCookie,
  writeThemeCookie,
} from "./request.server.js";

describe("safeAcceptLanguage", () => {
  beforeEach(() => {
    mockGetRequestHeaders.mockReset();
  });

  it("Accept-Language header が取れたらその文字列を返す", () => {
    mockGetRequestHeaders.mockReturnValue({ "accept-language": "ja,en;q=0.8" });
    expect(safeAcceptLanguage()).toStrictEqual("ja,en;q=0.8");
  });

  it("header object に accept-language キーが無ければ null", () => {
    mockGetRequestHeaders.mockReturnValue({});
    expect(safeAcceptLanguage()).toStrictEqual(null);
  });

  it("getRequestHeaders が throw した場合は catch して null fallback", () => {
    mockGetRequestHeaders.mockImplementation(() => {
      throw new Error("No StartEvent in AsyncLocalStorage");
    });
    expect(safeAcceptLanguage()).toStrictEqual(null);
  });
});

describe("safeCookieLang", () => {
  beforeEach(() => {
    mockGetCookie.mockReset();
  });

  it("valid な Lang (`ja`) はそのまま返す", () => {
    mockGetCookie.mockReturnValue("ja");
    expect(safeCookieLang()).toBe("ja");
  });

  it("valid な Lang (`en`) はそのまま返す", () => {
    mockGetCookie.mockReturnValue("en");
    expect(safeCookieLang()).toBe("en");
  });

  it("undefined (= 未設定) は null", () => {
    mockGetCookie.mockReturnValue(undefined);
    expect(safeCookieLang()).toBeNull();
  });

  it("invalid な値 (`fr` 等) は null", () => {
    mockGetCookie.mockReturnValue("fr");
    expect(safeCookieLang()).toBeNull();
  });

  it("getCookie が throw した場合は catch して null", () => {
    mockGetCookie.mockImplementation(() => {
      throw new Error("No StartEvent");
    });
    expect(safeCookieLang()).toBeNull();
  });
});

describe("writeLangCookie", () => {
  beforeEach(() => {
    mockSetCookie.mockReset();
  });

  it("Path / Max-Age / SameSite を込みで setCookie に渡す", () => {
    writeLangCookie("ja");
    expect(mockSetCookie).toHaveBeenCalledWith("ryantsuji_lang", "ja", {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
  });

  it("setCookie が throw しても上位に伝播しない", () => {
    mockSetCookie.mockImplementation(() => {
      throw new Error("No StartEvent");
    });
    expect(() => writeLangCookie("en")).not.toThrow();
  });
});

describe("safeCookieTheme", () => {
  beforeEach(() => {
    mockGetCookie.mockReset();
  });

  it("valid な Theme (`light`) はそのまま返す", () => {
    mockGetCookie.mockReturnValue("light");
    expect(safeCookieTheme()).toBe("light");
  });

  it("valid な Theme (`dark`) はそのまま返す", () => {
    mockGetCookie.mockReturnValue("dark");
    expect(safeCookieTheme()).toBe("dark");
  });

  it("undefined は null", () => {
    mockGetCookie.mockReturnValue(undefined);
    expect(safeCookieTheme()).toBeNull();
  });

  it("invalid 値 (`auto` 等) は null", () => {
    mockGetCookie.mockReturnValue("auto");
    expect(safeCookieTheme()).toBeNull();
  });

  it("getCookie が throw した場合は catch して null", () => {
    mockGetCookie.mockImplementation(() => {
      throw new Error("No StartEvent");
    });
    expect(safeCookieTheme()).toBeNull();
  });
});

describe("writeThemeCookie", () => {
  beforeEach(() => {
    mockSetCookie.mockReset();
  });

  it("Path / Max-Age / SameSite を込みで setCookie に渡す", () => {
    writeThemeCookie("dark");
    expect(mockSetCookie).toHaveBeenCalledWith("ryantsuji_theme", "dark", {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
  });

  it("setCookie が throw しても上位に伝播しない", () => {
    mockSetCookie.mockImplementation(() => {
      throw new Error("No StartEvent");
    });
    expect(() => writeThemeCookie("light")).not.toThrow();
  });
});
