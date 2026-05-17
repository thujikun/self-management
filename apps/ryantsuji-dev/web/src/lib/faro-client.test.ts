/**
 * Faro client init helper の test。
 *
 * `initializeFaro` は外部 SDK 呼び出しなので vi.mock で spy 化し、本 helper の
 * 「初期化条件 (URL guard / idempotent guard) + environment 判定」を実機データに
 * 寄せて踏む。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business Faro init helper の単体 test。`initializeFaro` を mock spy 化し、URL guard / idempotent guard / hostname → environment 判定を網羅して検証する
 * @graph-connects none
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const initializeFaroSpy = vi.fn();
const getWebInstrumentationsSpy = vi.fn(() => []);

vi.mock("@grafana/faro-web-sdk", () => ({
  initializeFaro: (...args: unknown[]) => initializeFaroSpy(...args),
  getWebInstrumentations: () => getWebInstrumentationsSpy(),
}));

const { initFaro, detectEnvironment, _resetFaroInitForTest } = await import("./faro-client.js");

describe("initFaro", () => {
  beforeEach(() => {
    initializeFaroSpy.mockClear();
    getWebInstrumentationsSpy.mockClear();
    _resetFaroInitForTest();
  });

  it("URL が空なら init を呼ばない (no-op return false)", () => {
    expect(initFaro("")).toBe(false);
    expect(initFaro(undefined)).toBe(false);
    expect(initializeFaroSpy).not.toHaveBeenCalled();
  });

  it("URL があれば 1 回だけ init を呼ぶ", () => {
    expect(initFaro("https://faro.example.com/collect")).toBe(true);
    expect(initializeFaroSpy).toHaveBeenCalledTimes(1);
    const arg = initializeFaroSpy.mock.calls[0]?.[0] as { url: string; app: { name: string } };
    expect(arg.url).toBe("https://faro.example.com/collect");
    expect(arg.app.name).toBe("ryantsuji-dev-web");
  });

  it("2 回目以降の init 呼び出しは idempotent guard で skip", () => {
    expect(initFaro("https://faro.example.com/collect")).toBe(true);
    expect(initFaro("https://faro.example.com/collect")).toBe(false);
    expect(initializeFaroSpy).toHaveBeenCalledTimes(1);
  });

  it("_resetFaroInitForTest を踏めば再 init できる", () => {
    expect(initFaro("https://faro.example.com/collect")).toBe(true);
    _resetFaroInitForTest();
    expect(initFaro("https://faro.example.com/collect")).toBe(true);
    expect(initializeFaroSpy).toHaveBeenCalledTimes(2);
  });
});

describe("detectEnvironment", () => {
  const originalLocation = window.location;

  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: originalLocation,
      configurable: true,
      writable: true,
    });
  });

  const setHostname = (hostname: string) => {
    Object.defineProperty(window, "location", {
      value: { ...originalLocation, hostname },
      configurable: true,
      writable: true,
    });
  };

  it("ryantsuji.dev は production", () => {
    setHostname("ryantsuji.dev");
    expect(detectEnvironment()).toBe("production");
  });

  it("www.ryantsuji.dev も production", () => {
    setHostname("www.ryantsuji.dev");
    expect(detectEnvironment()).toBe("production");
  });

  it("*.workers.dev は preview", () => {
    setHostname("ryantsuji-dev-web.foo.workers.dev");
    expect(detectEnvironment()).toBe("preview");
  });

  it("localhost / その他は development", () => {
    setHostname("localhost");
    expect(detectEnvironment()).toBe("development");
    setHostname("127.0.0.1");
    expect(detectEnvironment()).toBe("development");
  });
});
