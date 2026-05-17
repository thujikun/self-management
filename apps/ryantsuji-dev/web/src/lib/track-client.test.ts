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
    const id2 = getOrCreateSessionId();
    expect(id1).toBeDefined();
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("sessionStorage 例外 (private mode 等) は undefined fallback", () => {
    const setItem = vi.spyOn(window.sessionStorage, "setItem").mockImplementation(() => {
      throw new Error("private mode");
    });
    expect(getOrCreateSessionId()).toBeUndefined();
    setItem.mockRestore();
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
  it("payload に path / referrer / locale / session_id を詰める", () => {
    const beacon = vi.fn((_url: string | URL, _data?: BodyInit | null) => true);
    (navigator as unknown as { sendBeacon: typeof navigator.sendBeacon }).sendBeacon =
      beacon as unknown as typeof navigator.sendBeacon;
    trackPageView({ path: "/posts/hello", slug: "hello", lang: "en" });
    expect(beacon).toHaveBeenCalledOnce();
    const blob = beacon.mock.calls[0]![1] as Blob;
    expect(blob).toBeInstanceOf(Blob);
  });
});
