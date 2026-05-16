/**
 * `routes/posts/index.server.ts` の `runListPosts` 直叩き test。
 *
 * Accept-Language の各経路 (header あり / なし / throw) と override の優先順を
 * mock 経由で踏み分け、loader 側の lang 決定挙動を保証する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business runListPosts の lang 決定分岐網羅。override 優先 → Accept-Language → en fallback、test 環境で getRequestHeaders が throw した場合の catch 経路も踏む
 * @graph-connects none
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetRequestHeaders = vi.fn<() => Record<string, string>>();
vi.mock("@tanstack/react-start/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start/server")>();
  return {
    ...actual,
    getRequestHeaders: () => mockGetRequestHeaders(),
  };
});

import { runListPosts } from "./index.server.js";

describe("runListPosts", () => {
  beforeEach(() => {
    mockGetRequestHeaders.mockReset();
  });

  it("override='ja' は Accept-Language を無視", () => {
    mockGetRequestHeaders.mockReturnValue({ "accept-language": "en" });
    const out = runListPosts("ja");
    expect(out.lang).toBe("ja");
  });

  it("override='en' は Accept-Language='ja' でも en", () => {
    mockGetRequestHeaders.mockReturnValue({ "accept-language": "ja" });
    const out = runListPosts("en");
    expect(out.lang).toBe("en");
  });

  it("override 無し + Accept-Language='ja' → ja", () => {
    mockGetRequestHeaders.mockReturnValue({ "accept-language": "ja" });
    const out = runListPosts(undefined);
    expect(out.lang).toBe("ja");
  });

  it("override 無し + Accept-Language 無し → en fallback", () => {
    mockGetRequestHeaders.mockReturnValue({});
    const out = runListPosts(undefined);
    expect(out.lang).toBe("en");
  });

  it("getRequestHeaders が throw しても catch して en fallback", () => {
    mockGetRequestHeaders.mockImplementation(() => {
      throw new Error("No StartEvent in AsyncLocalStorage");
    });
    const out = runListPosts(undefined);
    expect(out.lang).toBe("en");
    expect(out.posts.length).toBeGreaterThan(0);
  });
});
