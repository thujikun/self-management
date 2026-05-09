/**
 * `@self/embedding` (AI Studio gemini-embedding-001 wrapper) の unit test。
 *
 * 実 HTTP は global fetch を vi.spyOn で短絡。`GEMINI_API_KEY` env で認証。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business AI Studio embedding wrapper のテスト。embedText / embedBatch / API key 認証 / エラー / 空入力 / batch concurrency / taskType 伝播の挙動を網羅
 * @graph-connects none
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

describe("embedText", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.GEMINI_API_KEY = "fake-key";
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it("成功時に embedding values を返す + URL の query string に key 入る", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ embedding: { values: [0.1, 0.2, 0.3] } }), { status: 200 }),
    );
    const { embedText } = await import("./index.js");
    const out = await embedText("hello");
    expect(out).toStrictEqual([0.1, 0.2, 0.3]);
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toMatch(
      /generativelanguage\.googleapis\.com.*models\/gemini-embedding-001:embedContent\?key=fake-key/,
    );
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toStrictEqual("application/json");
    // body には model + content.parts、taskType は未指定なので含まれない
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toStrictEqual({
      model: "models/gemini-embedding-001",
      content: { parts: [{ text: "hello" }] },
    });
  });

  it("taskType 指定時は body の taskType に伝播", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ embedding: { values: [0.1] } }), { status: 200 }),
    );
    const { embedText } = await import("./index.js");
    await embedText("query", "RETRIEVAL_QUERY");
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.taskType).toStrictEqual("RETRIEVAL_QUERY");
  });

  it("空文字 / whitespace のみ → エラー", async () => {
    const { embedText } = await import("./index.js");
    await expect(embedText("")).rejects.toThrow(/empty input/);
    await expect(embedText("   ")).rejects.toThrow(/empty input/);
  });

  it("HTTP non-OK → エラー (status と body を含む)", async () => {
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

  it("GEMINI_API_KEY が未設定ならエラー (AI Studio key 発行を促すメッセージ)", async () => {
    delete process.env.GEMINI_API_KEY;
    const { embedText } = await import("./index.js");
    await expect(embedText("hello")).rejects.toThrow(/GEMINI_API_KEY/);
    await expect(embedText("hello")).rejects.toThrow(/aistudio\.google\.com/);
  });

  it("API key は URL encode される (special char 含み)", async () => {
    process.env.GEMINI_API_KEY = "key/with+special";
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ embedding: { values: [0.1] } }), { status: 200 }),
    );
    const { embedText } = await import("./index.js");
    await embedText("x");
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toMatch(/key=key%2Fwith%2Bspecial/);
  });
});

describe("embedBatch", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.GEMINI_API_KEY = "fake-key";
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it("空配列 → 空配列、fetch 呼ばれない", async () => {
    const { embedBatch } = await import("./index.js");
    expect(await embedBatch([])).toStrictEqual([]);
    expect(fetchSpy.mock.calls).toStrictEqual([]);
  });

  it("3 件 → 順序保持で結果配列を返す", async () => {
    const responses: Array<{ embedding: { values: number[] } }> = [
      { embedding: { values: [10] } },
      { embedding: { values: [20] } },
      { embedding: { values: [30] } },
    ];
    let n = 0;
    fetchSpy.mockImplementation(async () => {
      const i = n++;
      return new Response(JSON.stringify(responses[i]), { status: 200 });
    });
    const { embedBatch } = await import("./index.js");
    const out = await embedBatch(["a", "b", "c"], 1);
    // concurrency=1 で逐次実行 → 順序保持を厳密に検証
    expect(out).toStrictEqual([[10], [20], [30]]);
  });

  it("concurrency=1 で逐次、件数分 fetch 呼ばれる", async () => {
    fetchSpy.mockImplementation(
      async () => new Response(JSON.stringify({ embedding: { values: [0] } }), { status: 200 }),
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
  it("model / dim を AI Studio gemini-embedding-001 / 3072 で公開", async () => {
    const m = await import("./index.js");
    expect({ model: m.EMBEDDING_MODEL, dim: m.EMBEDDING_DIMENSIONS }).toStrictEqual({
      model: "gemini-embedding-001",
      dim: 3072,
    });
  });
});
