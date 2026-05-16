/**
 * Root route (`__root.tsx`) のユニット test。
 *
 * `head()` で返るメタタグ群と、Component を `RouterProvider` 経由で SSR した結果に
 * `<html>` shell + landing コピーが含まれていることを確認する。後者の test は
 * router.tsx (`getRouter`) と routes/index.tsx (`IndexPage`) も同時に network 上で
 * 通過するため、3 ファイル分の coverage を一度に稼ぐ統合 path として機能する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 全ページ共通の HTML shell + meta が壊れないことを SSR で保証。RouterProvider 経由で render することで router.tsx + index.tsx も同 path で実行され、3 ファイル分の coverage を 1 統合テストで取れる
 * @graph-connects none
 */

import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { renderToString } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getRouter } from "../router.js";
import {
  Route,
  computeNextTheme,
  performSetLang,
  performToggleTheme,
  writeLangCookieDom,
  writeThemeCookieDom,
} from "./__root.js";

vi.mock("./__root.server.js", () => ({
  runResolveLang: vi.fn(() => ({ lang: "en", theme: null })),
}));
import { runResolveLang } from "./__root.server.js";

describe("__root route", () => {
  it("head() に title / charset / viewport / theme-color / og meta を含む", async () => {
    const headFn = Route.options.head;
    if (!headFn) throw new Error("Route.options.head is undefined");
    // head() は Awaitable<T> (= T | Promise<T>) なので await で unwrap する
    const head = await Promise.resolve(
      headFn(undefined as unknown as Parameters<typeof headFn>[0]),
    );

    const meta = head.meta ?? [];
    expect(meta).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ charSet: "utf-8" }),
        expect.objectContaining({ name: "viewport" }),
        expect.objectContaining({ title: "ryantsuji.dev" }),
        expect.objectContaining({ name: "theme-color", content: "#0abab5" }),
        expect.objectContaining({
          property: "og:url",
          content: "https://ryantsuji.dev",
        }),
        expect.objectContaining({
          property: "og:image",
          content: "https://ryantsuji.dev/og-image.png",
        }),
        expect.objectContaining({ name: "twitter:card", content: "summary_large_image" }),
        expect.objectContaining({
          name: "twitter:image",
          content: "https://ryantsuji.dev/og-image.png",
        }),
      ]),
    );

    // crawler が相対 path を解決しないため、og / twitter 画像と og:url は
    // 必ず https:// 始まりの絶対 URL になっていること
    const ogImage = meta.find(
      (m): m is { property: string; content: string } =>
        typeof m === "object" && m !== null && "property" in m && m.property === "og:image",
    );
    expect(ogImage?.content.startsWith("https://")).toBe(true);
    const twitterImage = meta.find(
      (m): m is { name: string; content: string } =>
        typeof m === "object" && m !== null && "name" in m && m.name === "twitter:image",
    );
    expect(twitterImage?.content.startsWith("https://")).toBe(true);
    const ogUrl = meta.find(
      (m): m is { property: string; content: string } =>
        typeof m === "object" && m !== null && "property" in m && m.property === "og:url",
    );
    expect(ogUrl?.content.startsWith("https://")).toBe(true);

    // `?url` import は vitest.config.ts の `cssUrlTestStub` plugin により
    // `data:text/css;base64,Lyo=` (= 空 CSS) に解決される。data URI を選んでいる
    // のは happy-dom が `<link rel="stylesheet">` を auto-fetch する挙動への対策
    // (相対 path だと localhost:3000 への connect が refused になり unhandled
    // rejection で coverage gate が落ちる)。production build では Vite が
    // `/assets/styles-<hash>.css` を emit する経路で、href が非空文字列になる
    // ことは build 経由で別途担保。ここでは「`?url` import から href に値が
    // 流れている」ことを sentinel data URI の literal 一致で固定し、`href:
    // "/styles.css"` 直書きへの regression や `href: ""` (= build pipeline
    // 非経由) への regression を test 側で必ず捕まえる。
    const links = head.links ?? [];
    expect(links).toStrictEqual([
      { rel: "stylesheet", href: "data:text/css;base64,Lyo=" },
      { rel: "icon", type: "image/svg+xml", href: "/logo-mark.svg" },
      { rel: "icon", type: "image/x-icon", href: "/favicon.ico" },
      { rel: "icon", type: "image/png", sizes: "48x48", href: "/favicon-48x48.png" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" },
      { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
      {
        rel: "alternate",
        type: "application/atom+xml",
        href: "/rss/en.xml",
        title: "ryantsuji.dev (EN)",
      },
      {
        rel: "alternate",
        type: "application/atom+xml",
        href: "/rss/ja.xml",
        title: "ryantsuji.dev (JP)",
      },
    ]);
  });

  it("RouterProvider 経由で root document + landing が SSR される", async () => {
    const router = getRouter({
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await router.load();

    const html = renderToString(<RouterProvider router={router} />);
    expect(html).toContain("<html");
    expect(html).toContain("<title>ryantsuji.dev</title>");
    // landing copy: 「engineering / design / product」を主軸に
    expect(html).toContain("engineering / design / product");
    expect(html).toContain('href="/posts"');
  });

  describe("RootDocument の data-theme 分岐", () => {
    const resolveLangMock = vi.mocked(runResolveLang);
    beforeEach(() => {
      resolveLangMock.mockReset();
    });

    async function ssrAt(initial: string): Promise<string> {
      const router = getRouter({
        history: createMemoryHistory({ initialEntries: [initial] }),
      });
      await router.load();
      return renderToString(<RouterProvider router={router} />);
    }

    it("theme=null (cookie 未設定) は <html> に data-theme を出さない", async () => {
      resolveLangMock.mockReturnValue({ lang: "en", theme: null });
      const html = await ssrAt("/");
      expect(html).not.toMatch(/<html[^>]+data-theme=/);
    });

    it('theme=dark は <html data-theme="dark"> を出す', async () => {
      resolveLangMock.mockReturnValue({ lang: "en", theme: "dark" });
      const html = await ssrAt("/");
      expect(html).toMatch(/<html[^>]*data-theme="dark"/);
    });

    it('theme=light は <html data-theme="light"> を出す', async () => {
      resolveLangMock.mockReturnValue({ lang: "en", theme: "light" });
      const html = await ssrAt("/");
      expect(html).toMatch(/<html[^>]*data-theme="light"/);
    });
  });

  describe("LangSwitcher の active 状態", () => {
    const resolveLangMock = vi.mocked(runResolveLang);
    beforeEach(() => {
      resolveLangMock.mockReset();
    });

    async function ssrAt(initial: string): Promise<string> {
      const router = getRouter({
        history: createMemoryHistory({ initialEntries: [initial] }),
      });
      await router.load();
      return renderToString(<RouterProvider router={router} />);
    }

    it("lang=en の時 EN button が active", async () => {
      resolveLangMock.mockReturnValue({ lang: "en", theme: null });
      const html = await ssrAt("/");
      expect(html).toMatch(/lang-switcher__btn lang-switcher__btn--active[^>]*>EN/);
      expect(html).toMatch(/lang-switcher__btn[^"]*"[^>]*aria-pressed="false"[^>]*>JA/);
    });

    it("lang=ja の時 JA button が active", async () => {
      resolveLangMock.mockReturnValue({ lang: "ja", theme: null });
      const html = await ssrAt("/");
      expect(html).toMatch(/lang-switcher__btn lang-switcher__btn--active[^>]*>JA/);
    });
  });

  describe("ThemeSwitcher の aria-label / data-current 分岐", () => {
    const resolveLangMock = vi.mocked(runResolveLang);
    beforeEach(() => {
      resolveLangMock.mockReset();
    });

    async function ssrAt(initial: string): Promise<string> {
      const router = getRouter({
        history: createMemoryHistory({ initialEntries: [initial] }),
      });
      await router.load();
      return renderToString(<RouterProvider router={router} />);
    }

    it("current=null: aria-label='toggle theme' / data-current='auto'", async () => {
      resolveLangMock.mockReturnValue({ lang: "en", theme: null });
      const html = await ssrAt("/");
      expect(html).toMatch(/aria-label="toggle theme"/);
      expect(html).toMatch(/data-current="auto"/);
    });

    it("current=dark: aria-label='switch to light theme' / data-current='dark'", async () => {
      resolveLangMock.mockReturnValue({ lang: "en", theme: "dark" });
      const html = await ssrAt("/");
      expect(html).toMatch(/aria-label="switch to light theme"/);
      expect(html).toMatch(/data-current="dark"/);
    });

    it("current=light: aria-label='switch to dark theme' / data-current='light'", async () => {
      resolveLangMock.mockReturnValue({ lang: "en", theme: "light" });
      const html = await ssrAt("/");
      expect(html).toMatch(/aria-label="switch to dark theme"/);
      expect(html).toMatch(/data-current="light"/);
    });
  });

  describe("computeNextTheme (pure)", () => {
    it("explicit=dark → light", () => {
      expect(computeNextTheme("dark", false)).toBe("light");
    });
    it("explicit=light → dark", () => {
      expect(computeNextTheme("light", true)).toBe("dark");
    });
    it("explicit=null + prefersDark=true → light (system dark の逆)", () => {
      expect(computeNextTheme(null, true)).toBe("light");
    });
    it("explicit=null + prefersDark=false → dark (system light の逆)", () => {
      expect(computeNextTheme(null, false)).toBe("dark");
    });
  });

  describe("writeLangCookieDom / writeThemeCookieDom (pure)", () => {
    it("writeLangCookieDom は cookie に Path / Max-Age / SameSite を含む value をセットする", () => {
      const doc = { cookie: "" };
      writeLangCookieDom(doc, "ja");
      expect(doc.cookie).toBe("ryantsuji_lang=ja; Path=/; Max-Age=31536000; SameSite=Lax");
    });

    it("writeThemeCookieDom は cookie に Path / Max-Age / SameSite を含む value をセットする", () => {
      const doc = { cookie: "" };
      writeThemeCookieDom(doc, "dark");
      expect(doc.cookie).toBe("ryantsuji_theme=dark; Path=/; Max-Age=31536000; SameSite=Lax");
    });
  });

  describe("performSetLang (pure)", () => {
    it("docAvailable=false なら no-op (SSR early-return)", () => {
      const doc = { cookie: "" };
      const invalidate = vi.fn();
      performSetLang({ docAvailable: false, doc, invalidate }, "ja");
      expect(doc.cookie).toBe("");
      expect(invalidate).not.toHaveBeenCalled();
    });

    it("docAvailable=true なら cookie 書き + invalidate", () => {
      const doc = { cookie: "" };
      const invalidate = vi.fn();
      performSetLang({ docAvailable: true, doc, invalidate }, "ja");
      expect(doc.cookie).toContain("ryantsuji_lang=ja");
      expect(invalidate).toHaveBeenCalledOnce();
    });
  });

  describe("LangSwitcher / ThemeSwitcher の click DOM interaction (createRoot)", () => {
    const resolveLangMock = vi.mocked(runResolveLang);
    let container: HTMLDivElement;
    let root: Root;
    let cookieJar = "";

    beforeEach(() => {
      resolveLangMock.mockReset();
      resolveLangMock.mockReturnValue({ lang: "en", theme: null });
      container = document.createElement("div");
      document.body.appendChild(container);
      cookieJar = "";
      Object.defineProperty(document, "cookie", {
        configurable: true,
        get: () => cookieJar,
        set: (v: string) => {
          const first = v.split(";")[0];
          if (first) cookieJar = cookieJar ? `${cookieJar}; ${first}` : first;
        },
      });
      // matchMedia stub (happy-dom default は無し)
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: () => ({ matches: false }),
      });
    });

    afterEach(() => {
      act(() => root?.unmount());
      container.remove();
      Reflect.deleteProperty(document, "cookie");
    });

    async function mountRouter(initial: string) {
      const router = getRouter({
        history: createMemoryHistory({ initialEntries: [initial] }),
      });
      await router.load();
      act(() => {
        root = createRoot(container);
        root.render(<RouterProvider router={router} />);
      });
    }

    it("LangSwitcher の JA button click で cookie に ryantsuji_lang=ja", async () => {
      await mountRouter("/");
      const jaBtn = Array.from(container.querySelectorAll("button.lang-switcher__btn")).find(
        (b) => b.textContent === "JA",
      ) as HTMLButtonElement | undefined;
      expect(jaBtn).toBeDefined();
      act(() => {
        jaBtn!.click();
      });
      expect(cookieJar).toContain("ryantsuji_lang=ja");
    });

    it("ThemeSwitcher の click で cookie に ryantsuji_theme が書かれる", async () => {
      await mountRouter("/");
      const themeBtn = container.querySelector("button.theme-switcher") as HTMLButtonElement | null;
      expect(themeBtn).toBeTruthy();
      act(() => {
        themeBtn!.click();
      });
      expect(cookieJar).toMatch(/ryantsuji_theme=(dark|light)/);
    });
  });

  describe("performToggleTheme (pure)", () => {
    function makeHtmlEl(themeAttr: string | null) {
      return {
        getAttribute: (name: string) => (name === "data-theme" ? themeAttr : null),
      };
    }

    it("docAvailable=false なら no-op", () => {
      const doc = { cookie: "" };
      const invalidate = vi.fn();
      performToggleTheme({
        docAvailable: false,
        htmlEl: makeHtmlEl(null),
        doc,
        prefersDark: false,
        invalidate,
      });
      expect(doc.cookie).toBe("");
      expect(invalidate).not.toHaveBeenCalled();
    });

    it("explicit=dark → light に切替 + invalidate", () => {
      const doc = { cookie: "" };
      const invalidate = vi.fn();
      performToggleTheme({
        docAvailable: true,
        htmlEl: makeHtmlEl("dark"),
        doc,
        prefersDark: false,
        invalidate,
      });
      expect(doc.cookie).toContain("ryantsuji_theme=light");
      expect(invalidate).toHaveBeenCalledOnce();
    });

    it("explicit=null + prefersDark=true → light", () => {
      const doc = { cookie: "" };
      performToggleTheme({
        docAvailable: true,
        htmlEl: makeHtmlEl(null),
        doc,
        prefersDark: true,
        invalidate: () => {},
      });
      expect(doc.cookie).toContain("ryantsuji_theme=light");
    });

    it("explicit=null + prefersDark=false → dark", () => {
      const doc = { cookie: "" };
      performToggleTheme({
        docAvailable: true,
        htmlEl: makeHtmlEl(null),
        doc,
        prefersDark: false,
        invalidate: () => {},
      });
      expect(doc.cookie).toContain("ryantsuji_theme=dark");
    });
  });

  describe("SiteFooter の X handle 分岐", () => {
    const resolveLangMock = vi.mocked(runResolveLang);
    beforeEach(() => {
      resolveLangMock.mockReset();
    });

    async function ssrAt(initial: string): Promise<string> {
      const router = getRouter({
        history: createMemoryHistory({ initialEntries: [initial] }),
      });
      await router.load();
      return renderToString(<RouterProvider router={router} />);
    }

    it("lang=en は @ryantsuji を footer に出す", async () => {
      resolveLangMock.mockReturnValue({ lang: "en", theme: null });
      const html = await ssrAt("/");
      expect(html).toMatch(/href="https:\/\/x\.com\/ryantsuji"/);
    });

    it("lang=ja は @RyanAircloset を footer に出す (JP 公式)", async () => {
      resolveLangMock.mockReturnValue({ lang: "ja", theme: null });
      const html = await ssrAt("/");
      expect(html).toMatch(/href="https:\/\/x\.com\/RyanAircloset"/);
    });
  });
});
