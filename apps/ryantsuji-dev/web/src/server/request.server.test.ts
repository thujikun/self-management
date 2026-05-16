/**
 * `server/request.server.ts` の `safeAcceptLanguage` 直叩き test。
 *
 * `getRequestHeaders` を `vi.mock` で差し替え、(a) header 取得成功、(b) header 無し
 * (= `accept-language` undefined)、(c) server runtime 外 throw の 3 経路を踏み、
 * try/catch + `?? null` fallback の挙動を確定させる。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business safeAcceptLanguage の分岐網羅 test。Accept-Language あり / なし / getRequestHeaders throw の 3 経路を踏み、SoT 化した helper の挙動を route 側 test と独立に保証する
 * @graph-connects none
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetRequestHeaders = vi.fn<() => Record<string, string | undefined>>();
vi.mock("@tanstack/react-start/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start/server")>();
  return {
    ...actual,
    getRequestHeaders: () => mockGetRequestHeaders(),
  };
});

import { safeAcceptLanguage } from "./request.server.js";

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
