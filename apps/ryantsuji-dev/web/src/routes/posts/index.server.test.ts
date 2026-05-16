/**
 * `routes/posts/index.server.ts` の `runListPosts` 直叩き test。
 *
 * `safeAcceptLanguage` / `safeCookieLang` / `writeLangCookie` を mock し、override
 * / cookie / Accept-Language の優先順、cookie 上書きが override 経路でのみ走る経路、
 * tag filter の有無を踏み分ける。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business runListPosts の lang 決定 + tag filter 分岐網羅。override > cookie > Accept-Language > en の 4 段優先、override 経由の cookie 上書き、tag filter 一致 / 不一致を全パターン踏む
 * @graph-connects none
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSafeAcceptLanguage = vi.fn<() => string | null>();
const mockSafeCookieLang = vi.fn<() => "en" | "ja" | null>();
const mockWriteLangCookie = vi.fn<(lang: "en" | "ja") => void>();

vi.mock("../../server/request.server.js", () => ({
  safeAcceptLanguage: () => mockSafeAcceptLanguage(),
  safeCookieLang: () => mockSafeCookieLang(),
  writeLangCookie: (lang: "en" | "ja") => mockWriteLangCookie(lang),
}));

import { runListPosts } from "./index.server.js";

describe("runListPosts", () => {
  beforeEach(() => {
    mockSafeAcceptLanguage.mockReset();
    mockSafeCookieLang.mockReset();
    mockWriteLangCookie.mockReset();
    mockSafeAcceptLanguage.mockReturnValue(null);
    mockSafeCookieLang.mockReturnValue(null);
  });

  it("override='ja' は Accept-Language='en' でも ja", () => {
    mockSafeAcceptLanguage.mockReturnValue("en");
    const out = runListPosts("ja", undefined);
    expect(out.lang).toBe("ja");
  });

  it("override='en' は Accept-Language='ja' でも en", () => {
    mockSafeAcceptLanguage.mockReturnValue("ja");
    const out = runListPosts("en", undefined);
    expect(out.lang).toBe("en");
  });

  it("override 無し + Accept-Language='ja' → ja", () => {
    mockSafeAcceptLanguage.mockReturnValue("ja");
    const out = runListPosts(undefined, undefined);
    expect(out.lang).toBe("ja");
  });

  it("override 無し + Accept-Language 無し → en fallback", () => {
    const out = runListPosts(undefined, undefined);
    expect(out.lang).toBe("en");
  });

  it("override 無し + cookie='ja' + Accept-Language='en' → ja (cookie 優先)", () => {
    mockSafeCookieLang.mockReturnValue("ja");
    mockSafeAcceptLanguage.mockReturnValue("en");
    const out = runListPosts(undefined, undefined);
    expect(out.lang).toBe("ja");
  });

  it("override が cookie と異なれば cookie を上書きする", () => {
    mockSafeCookieLang.mockReturnValue("en");
    runListPosts("ja", undefined);
    expect(mockWriteLangCookie).toHaveBeenCalledWith("ja");
  });

  it("override が cookie と同じなら cookie 書き戻しは skip", () => {
    mockSafeCookieLang.mockReturnValue("ja");
    runListPosts("ja", undefined);
    expect(mockWriteLangCookie).not.toHaveBeenCalled();
  });

  it("override 無しなら cookie 書き戻しは skip", () => {
    mockSafeCookieLang.mockReturnValue(null);
    runListPosts(undefined, undefined);
    expect(mockWriteLangCookie).not.toHaveBeenCalled();
  });

  it("tag filter 指定で該当 tag を持つ post のみ返す", () => {
    const out = runListPosts(undefined, "mcp");
    expect(out.tag).toBe("mcp");
    expect(out.posts.length).toBeGreaterThan(0);
    for (const p of out.posts) {
      expect(p.tags).toContain("mcp");
    }
  });

  it("tag filter で hit しない tag は posts が空", () => {
    const out = runListPosts(undefined, "this-tag-does-not-exist-anywhere");
    expect(out.posts).toStrictEqual([]);
    expect(out.tag).toBe("this-tag-does-not-exist-anywhere");
  });

  it("tag filter 未指定なら tag=null", () => {
    const out = runListPosts(undefined, undefined);
    expect(out.tag).toBeNull();
    expect(out.posts.length).toBeGreaterThan(0);
  });
});
