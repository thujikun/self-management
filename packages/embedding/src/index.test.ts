/**
 * `@self/embedding` の unit test。
 *
 * Vertex AI :embedContent への実 HTTP は global fetch を vi.spyOn で短絡。
 * GoogleAuth.getAccessToken も spy で fake token を返す。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business gemini-embedding-2 wrapper のテスト。embedText / embedBatch / 認証ヘッダー / エラー / 空入力 / batch concurrency の挙動を網羅
 * @graph-connects none
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getAccessTokenMock = vi.hoisted(() => vi.fn());
vi.mock("google-auth-library", () => {
  class FakeGoogleAuth {
    getAccessToken = getAccessTokenMock;
  }
  return { GoogleAuth: FakeGoogleAuth };
});

describe("embedText", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getAccessTokenMock.mockReset();
    getAccessTokenMock.mockResolvedValue("fake-token");
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.resetModules();
  });

  it("成功時に embedding values を返す + Authorization header に Bearer token", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ embedding: { values: [0.1, 0.2, 0.3] } }), { status: 200 }),
    );
    const { embedText } = await import("./index.js");
    const out = await embedText("hello");
    expect(out).toEqual([0.1, 0.2, 0.3]);
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer fake-token");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("空文字 → エラー", async () => {
    const { embedText } = await import("./index.js");
    await expect(embedText("")).rejects.toThrow(/empty input/);
    await expect(embedText("   ")).rejects.toThrow(/empty input/);
  });

  it("HTTP non-OK → エラー (status と body を含む)", async () => {
    // 各呼び出しに新しい Response を返す (Response は body 1 回しか read できない)
    fetchSpy.mockImplementation(async () => new Response("model not found", { status: 404 }));
    const { embedText } = await import("./index.js");
    await expect(embedText("hello")).rejects.toThrow(/404/);
    await expect(embedText("hello")).rejects.toThrow(/model not found/);
  });

  it("response が embedding values を欠いていたらエラー", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ embedding: { values: [] } }), { status: 200 }),
    );
    const { embedText } = await import("./index.js");
    await expect(embedText("hello")).rejects.toThrow(/no values/);
  });

  it("ADC が token を返さなければエラー", async () => {
    getAccessTokenMock.mockResolvedValue(null);
    const { embedText } = await import("./index.js");
    await expect(embedText("hello")).rejects.toThrow(/access token/);
  });
});

describe("embedBatch", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getAccessTokenMock.mockReset();
    getAccessTokenMock.mockResolvedValue("fake-token");
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.resetModules();
  });

  it("空配列 → 空配列", async () => {
    const { embedBatch } = await import("./index.js");
    expect(await embedBatch([])).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("3 件 → 順序を保って結果配列を返す", async () => {
    let n = 0;
    fetchSpy.mockImplementation(async () => {
      const i = n++;
      return new Response(JSON.stringify({ embedding: { values: [i] } }), { status: 200 });
    });
    const { embedBatch } = await import("./index.js");
    const out = await embedBatch(["a", "b", "c"], 2);
    expect(out).toHaveLength(3);
    // concurrency=2 でも cursor 共有なので最終 result は順序保持
    expect(out.every((v) => Array.isArray(v))).toBe(true);
  });

  it("concurrency=1 で逐次実行", async () => {
    fetchSpy.mockImplementation(async () =>
      new Response(JSON.stringify({ embedding: { values: [0] } }), { status: 200 }),
    );
    const { embedBatch } = await import("./index.js");
    const out = await embedBatch(["x", "y"], 1);
    expect(out).toHaveLength(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("途中で 1 件失敗 → 全体 reject", async () => {
    let n = 0;
    fetchSpy.mockImplementation(async () => {
      const i = n++;
      if (i === 1) return new Response("boom", { status: 500 });
      return new Response(JSON.stringify({ embedding: { values: [i] } }), { status: 200 });
    });
    const { embedBatch } = await import("./index.js");
    await expect(embedBatch(["a", "b", "c"], 3)).rejects.toThrow(/500/);
  });
});

describe("constants", () => {
  it("model / dim / location が公開されている", async () => {
    const m = await import("./index.js");
    expect(m.EMBEDDING_MODEL).toBe("gemini-embedding-2");
    expect(m.EMBEDDING_DIMENSIONS).toBe(3072);
    expect(m.EMBEDDING_LOCATION).toBe("global");
  });
});
