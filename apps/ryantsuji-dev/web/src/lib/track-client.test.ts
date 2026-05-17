/**
 * track-client.ts の test。
 *
 * happy-dom 上で sessionStorage / navigator / fetch を spy 化し、beacon の経路選択
 * (sendBeacon → fetch fallback → silent fail) を全 path 踏む。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business client beacon の単体 test。session_id の sessionStorage 永続化と UUID 再利用、utm_* 抽出、sendBeacon→fetch keepalive fallback の経路選択を全 path 網羅
 * @graph-connects none
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  extractUtm,
  getOrCreateSessionId,
  sendTrackBeacon,
  trackPageView,
} from "./track-client.js";

const originalSendBeacon = navigator.sendBeacon;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  (navigator as unknown as { sendBeacon: typeof navigator.sendBeacon }).sendBeacon =
    originalSendBeacon;
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("getOrCreateSessionId", () => {
  it("初回は新 UUID を生成、2 回目は同じ値を返す", () => {
    const id1 = getOrCreateSessionId();
    expect(id1).toMatch(/^[0-9a-f-]{36}$/);
    expect(getOrCreateSessionId()).toBe(id1);
    expect(window.sessionStorage.getItem("rt:session_id")).toBe(id1);
  });

  it("sessionStorage 例外 (private mode 等) は undefined fallback", () => {
    const setItem = vi.spyOn(window.sessionStorage, "setItem").mockImplementation(() => {
      throw new Error("private mode");
    });
    expect(getOrCreateSessionId()).toStrictEqual(undefined);
    setItem.mockRestore();
  });

  it("SSR (window undef) は undefined を返す early-return", () => {
    const original = globalThis.window;
    (globalThis as unknown as { window: unknown }).window = undefined;
    try {
      expect(getOrCreateSessionId()).toStrictEqual(undefined);
    } finally {
      (globalThis as unknown as { window: typeof original }).window = original;
    }
  });
});

describe("extractUtm", () => {
  it("`?` 付き / 無しの両方を扱える", () => {
    expect(extractUtm("?utm_source=tw&utm_medium=feed&utm_campaign=blog")).toStrictEqual({
      utm_source: "tw",
      utm_medium: "feed",
      utm_campaign: "blog",
    });
    expect(extractUtm("utm_source=x")).toStrictEqual({ utm_source: "x" });
  });

  it("utm key が無ければ空 object", () => {
    expect(extractUtm("?lang=ja")).toStrictEqual({});
  });
});

describe("sendTrackBeacon", () => {
  it("sendBeacon が true を返したらそれ採用 (fetch は呼ばない)", () => {
    const beacon = vi.fn(() => true);
    (navigator as unknown as { sendBeacon: typeof navigator.sendBeacon }).sendBeacon =
      beacon as unknown as typeof navigator.sendBeacon;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    expect(sendTrackBeacon({ event_type: "page_view", path: "/" })).toBe(true);
    expect(beacon).toHaveBeenCalledOnce();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sendBeacon が false → fetch keepalive にフォールバック", () => {
    const beacon = vi.fn(() => false);
    (navigator as unknown as { sendBeacon: typeof navigator.sendBeacon }).sendBeacon =
      beacon as unknown as typeof navigator.sendBeacon;
    const fetchSpy = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    expect(sendTrackBeacon({ event_type: "page_view", path: "/" })).toBe(true);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
  });

  it("sendBeacon が throw → fetch keepalive にフォールバック", () => {
    const beacon = vi.fn(() => {
      throw new Error("boom");
    });
    (navigator as unknown as { sendBeacon: typeof navigator.sendBeacon }).sendBeacon =
      beacon as unknown as typeof navigator.sendBeacon;
    const fetchSpy = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    expect(sendTrackBeacon({ event_type: "page_view" })).toBe(true);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});

describe("trackPageView", () => {
  it("payload に path / slug / lang / viewport / locale / session_id を詰める", async () => {
    const beacon = vi.fn((_url: string | URL, _data?: BodyInit | null) => true);
    (navigator as unknown as { sendBeacon: typeof navigator.sendBeacon }).sendBeacon =
      beacon as unknown as typeof navigator.sendBeacon;
    Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 720, configurable: true });
    Object.defineProperty(navigator, "language", { value: "en-US", configurable: true });
    Object.defineProperty(document, "referrer", {
      value: "https://ref.test/x",
      configurable: true,
    });

    trackPageView({ path: "/posts/hello", slug: "hello", lang: "en" });
    expect(beacon).toHaveBeenCalledOnce();
    const [url, data] = beacon.mock.calls[0]!;
    expect(String(url)).toBe("/api/track");
    const json = JSON.parse(await (data as Blob).text()) as Record<string, unknown>;
    // session_id は UUID で生成される (regex 確認後、固定値に置換して toStrictEqual)
    expect(json.session_id).toMatch(/^[0-9a-f-]{36}$/);
    json.session_id = "<uuid>";
    expect(json).toStrictEqual({
      event_type: "page_view",
      path: "/posts/hello",
      slug: "hello",
      lang: "en",
      referrer: "https://ref.test/x",
      viewport_w: 1280,
      viewport_h: 720,
      locale: "en-US",
      session_id: "<uuid>",
    });
  });

  it("document.referrer が空文字なら payload.referrer は undefined (省略される)", async () => {
    const beacon = vi.fn((_url: string | URL, _data?: BodyInit | null) => true);
    (navigator as unknown as { sendBeacon: typeof navigator.sendBeacon }).sendBeacon =
      beacon as unknown as typeof navigator.sendBeacon;
    Object.defineProperty(document, "referrer", { value: "", configurable: true });
    Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
    Object.defineProperty(navigator, "language", { value: "ja-JP", configurable: true });
    trackPageView({ path: "/" });
    const [, data] = beacon.mock.calls[0]!;
    const json = JSON.parse(await (data as Blob).text()) as Record<string, unknown>;
    expect(json.session_id).toMatch(/^[0-9a-f-]{36}$/);
    json.session_id = "<uuid>";
    // JSON.stringify は undefined を omit するので、referrer / slug / lang など unset
    // field は payload に現れない。これで「empty 文字列 → undefined → 省略」の動作を固定
    expect(json).toStrictEqual({
      event_type: "page_view",
      path: "/",
      viewport_w: 1024,
      viewport_h: 768,
      locale: "ja-JP",
      session_id: "<uuid>",
    });
  });

  it("SSR (window undef) は no-op で beacon を呼ばない", () => {
    // happy-dom 上で window を一時的に delete して SSR shape を再現する
    const original = globalThis.window;
    (globalThis as unknown as { window: unknown }).window = undefined;
    try {
      // window unset の状態で early return 経路 (戻り値 void、副作用なし)
      trackPageView({ path: "/" });
    } finally {
      (globalThis as unknown as { window: typeof original }).window = original;
    }
  });
});

describe("sendTrackBeacon — 全 path 失敗 / SSR", () => {
  it("sendBeacon throw + fetch も throw → false で silent fail", () => {
    const beacon = vi.fn(() => {
      throw new Error("beacon boom");
    });
    (navigator as unknown as { sendBeacon: typeof navigator.sendBeacon }).sendBeacon =
      beacon as unknown as typeof navigator.sendBeacon;
    const fetchSpy = vi.fn(() => {
      throw new Error("fetch boom");
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    expect(sendTrackBeacon({ event_type: "page_view" })).toBe(false);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("sendBeacon false + fetch が rejected Promise を返しても caller には true (silent .catch で潰す)", async () => {
    const beacon = vi.fn(() => false);
    (navigator as unknown as { sendBeacon: typeof navigator.sendBeacon }).sendBeacon =
      beacon as unknown as typeof navigator.sendBeacon;
    const fetchSpy = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
      Promise.reject(new Error("net down")),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    expect(sendTrackBeacon({ event_type: "page_view" })).toBe(true);
    expect(fetchSpy).toHaveBeenCalledOnce();
    // fetch().catch arrow が走るまで待つ (microtask flush)
    await Promise.resolve();
    await Promise.resolve();
  });

  it("navigator unset (SSR) は false を返して何も呼ばない", () => {
    const original = globalThis.navigator;
    (globalThis as unknown as { navigator: unknown }).navigator = undefined;
    try {
      expect(sendTrackBeacon({ event_type: "page_view" })).toBe(false);
    } finally {
      (globalThis as unknown as { navigator: typeof original }).navigator = original;
    }
  });

  it("sendBeacon 不在 / fetch も不在で false", () => {
    (navigator as unknown as { sendBeacon: undefined }).sendBeacon = undefined;
    (globalThis as unknown as { fetch: undefined }).fetch = undefined;
    expect(sendTrackBeacon({ event_type: "page_view" })).toBe(false);
  });
});
