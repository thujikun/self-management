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

  it("URL が空文字なら init を呼ばず false (戻り値と spy 呼び出し回数を同時に固定)", () => {
    expect({
      result: initFaro(""),
      calls: initializeFaroSpy.mock.calls.length,
    }).toStrictEqual({ result: false, calls: 0 });
  });

  it("URL が undefined でも init を呼ばず false", () => {
    expect({
      result: initFaro(undefined),
      calls: initializeFaroSpy.mock.calls.length,
    }).toStrictEqual({ result: false, calls: 0 });
  });

  it("URL があれば initializeFaro を 1 回呼び、url / app.name / app.environment を渡して true", () => {
    const result = initFaro("https://faro.example.com/collect");
    const arg = initializeFaroSpy.mock.calls[0]?.[0] as {
      url: string;
      app: { name: string; version: string; environment: string };
    };
    expect({
      result,
      calls: initializeFaroSpy.mock.calls.length,
      url: arg?.url,
      appName: arg?.app?.name,
      appVersion: arg?.app?.version,
    }).toStrictEqual({
      result: true,
      calls: 1,
      url: "https://faro.example.com/collect",
      appName: "ryantsuji-dev-web",
      appVersion: "0.1.0",
    });
  });

  it("2 回目以降の init 呼び出しは idempotent guard で skip (1 回目 true / 2 回目 false / spy は 1 回のみ)", () => {
    const first = initFaro("https://faro.example.com/collect");
    const second = initFaro("https://faro.example.com/collect");
    expect({
      first,
      second,
      calls: initializeFaroSpy.mock.calls.length,
    }).toStrictEqual({ first: true, second: false, calls: 1 });
  });

  it("_resetFaroInitForTest を踏めば再 init できる (両方 true / spy は 2 回)", () => {
    const first = initFaro("https://faro.example.com/collect");
    _resetFaroInitForTest();
    const second = initFaro("https://faro.example.com/collect");
    expect({
      first,
      second,
      calls: initializeFaroSpy.mock.calls.length,
    }).toStrictEqual({ first: true, second: true, calls: 2 });
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
