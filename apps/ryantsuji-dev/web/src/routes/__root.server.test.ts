/**
 * runResolveLang の priority 検証。?lang= URL override > cookie > Accept-Language >
 * en の 4 段優先を inline で固定し、UI 状態 (LangSwitcher) と server 解決 lang の
 * 乖離が起きないことを保証する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business runResolveLang の lang 解決 priority を 4 段すべて踏んで固定する。?lang= URL override が cookie / Accept-Language を上書きする経路を test で保証し、Zenn / dev.to からの ?lang= 着地で LangSwitcher が JA active のまま本文が英語、のような UI / 実 lang 乖離を再発させない
 * @graph-connects none
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSafeUrlLang = vi.fn<() => "en" | "ja" | null>();
const mockSafeCookieLang = vi.fn<() => "en" | "ja" | null>();
const mockSafeAcceptLanguage = vi.fn<() => string | null>();
const mockSafeCookieTheme = vi.fn<() => "light" | "dark" | null>();

vi.mock("../server/request.server.js", () => ({
  safeUrlLang: () => mockSafeUrlLang(),
  safeCookieLang: () => mockSafeCookieLang(),
  safeAcceptLanguage: () => mockSafeAcceptLanguage(),
  safeCookieTheme: () => mockSafeCookieTheme(),
}));

import { runResolveLang } from "./__root.server.js";

describe("runResolveLang", () => {
  beforeEach(() => {
    mockSafeUrlLang.mockReset();
    mockSafeCookieLang.mockReset();
    mockSafeAcceptLanguage.mockReset();
    mockSafeCookieTheme.mockReset();
    mockSafeUrlLang.mockReturnValue(null);
    mockSafeCookieLang.mockReturnValue(null);
    mockSafeAcceptLanguage.mockReturnValue(null);
    mockSafeCookieTheme.mockReturnValue(null);
  });

  it("?lang= override が cookie / Accept-Language を勝つ (UI 乖離 fix の本旨)", () => {
    mockSafeUrlLang.mockReturnValue("en");
    mockSafeCookieLang.mockReturnValue("ja");
    mockSafeAcceptLanguage.mockReturnValue("ja,en;q=0.8");
    expect(runResolveLang()).toStrictEqual({ lang: "en", theme: null });
  });

  it("?lang= 未設定なら cookie が次点", () => {
    mockSafeCookieLang.mockReturnValue("ja");
    mockSafeAcceptLanguage.mockReturnValue("en,ja;q=0.8");
    expect(runResolveLang().lang).toBe("ja");
  });

  it("?lang= / cookie 共に無ければ Accept-Language を読む", () => {
    mockSafeAcceptLanguage.mockReturnValue("ja,en;q=0.8");
    expect(runResolveLang().lang).toBe("ja");
  });

  it("どれも無ければ en にフォールバック", () => {
    expect(runResolveLang().lang).toBe("en");
  });

  it("theme は cookieTheme で決まり、無ければ null (system 任せ)", () => {
    mockSafeCookieTheme.mockReturnValue("dark");
    expect(runResolveLang().theme).toBe("dark");
  });

  it("theme cookie 未設定なら null (CSS の prefers-color-scheme に委ねる)", () => {
    expect(runResolveLang().theme).toBeNull();
  });
});
