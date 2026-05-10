/**
 * `@self/embedding` (Vertex AI gemini-embedding-2 wrapper) の unit test。
 *
 * 実 HTTP は global fetch を vi.spyOn で短絡。GoogleAuth は `_setAuthForTest` で
 * 差し替えてアクセストークン取得経路を mock。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business Vertex AI embedding wrapper のテスト。embedText / embedBatch / ADC token 認証 / エラー / 空入力 / batch concurrency / taskType 伝播の挙動を網羅
 * @graph-connects none
 */

import type { GoogleAuth } from "google-auth-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

/**
 * GoogleAuth の最小 mock。`getClient().getAccessToken()` で token 文字列を返す。
 *
 * @graph-connects none
 */
function makeFakeAuth(token: string | null = "fake-token"): GoogleAuth {
  return {
    getClient: async () => ({
      getAccessToken: async () => ({ token }),
    }),
  } as unknown as GoogleAuth;
}

describe("embedText", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.GOOGLE_CLOUD_PROJECT = "test-project";
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(async () => {
    fetchSpy.mockRestore();
    const { _setAuthForTest } = await import("./index.js");
    _setAuthForTest(null);
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it("成功時に embedding.values を返す + Vertex AI :embedContent endpoint を Bearer 認証で叩く", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ embedding: { values: [0.1, 0.2, 0.3] } }), { status: 200 }),
    );
    const { embedText, _setAuthForTest } = await import("./index.js");
    _setAuthForTest(makeFakeAuth("fake-token"));
    const out = await embedText("hello");
    expect(out).toStrictEqual([0.1, 0.2, 0.3]);

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toBe(
      "https://aiplatform.googleapis.com/v1/projects/test-project/locations/global/publishers/google/models/gemini-embedding-2:embedContent",
    );
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toStrictEqual("Bearer fake-token");
    expect(headers["Content-Type"]).toStrictEqual("application/json");
    // body には content.parts[].text 入る、taskType 未指定なら含まれない
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toStrictEqual({ content: { parts: [{ text: "hello" }] } });
  });

  it("taskType 指定時は body.taskType に伝播", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ embedding: { values: [0.1] } }), { status: 200 }),
    );
    const { embedText, _setAuthForTest } = await import("./index.js");
    _setAuthForTest(makeFakeAuth());
    await embedText("query", "RETRIEVAL_QUERY");
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toStrictEqual({
      content: { parts: [{ text: "query" }] },
      taskType: "RETRIEVAL_QUERY",
    });
  });

  it("空文字 / whitespace のみ → エラー", async () => {
    const { embedText } = await import("./index.js");
    await expect(embedText("")).rejects.toThrow(/empty input/);
    await expect(embedText("   ")).rejects.toThrow(/empty input/);
  });

  it("HTTP non-OK → エラー (status と body を含む)", async () => {
    fetchSpy.mockImplementation(async () => new Response("model not found", { status: 404 }));
    const { embedText, _setAuthForTest } = await import("./index.js");
    _setAuthForTest(makeFakeAuth());
    await expect(embedText("hello")).rejects.toThrow(/404/);
    await expect(embedText("hello")).rejects.toThrow(/model not found/);
  });

  it("response が embedding.values を欠いていたらエラー", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ embedding: { values: [] } }), { status: 200 }),
    );
    const { embedText, _setAuthForTest } = await import("./index.js");
    _setAuthForTest(makeFakeAuth());
    await expect(embedText("hello")).rejects.toThrow(/no values/);
  });

  it("access token が取得できない (null) ならエラー (ADC 設定を促すメッセージ)", async () => {
    const { embedText, _setAuthForTest } = await import("./index.js");
    _setAuthForTest(makeFakeAuth(null));
    await expect(embedText("hello")).rejects.toThrow(/access token/);
    await expect(embedText("hello")).rejects.toThrow(/GOOGLE_APPLICATION_CREDENTIALS/);
  });

  it("GOOGLE_CLOUD_PROJECT 未設定ならエラー (silent fallback で意図外 project 課金を防ぐ)", async () => {
    delete process.env.GOOGLE_CLOUD_PROJECT;
    const { embedText, _setAuthForTest } = await import("./index.js");
    _setAuthForTest(makeFakeAuth());
    await expect(embedText("hello")).rejects.toThrow(/GOOGLE_CLOUD_PROJECT/);
    await expect(embedText("hello")).rejects.toThrow(/\.envrc/);
  });
});

describe("embedBatch", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.GOOGLE_CLOUD_PROJECT = "test-project";
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(async () => {
    fetchSpy.mockRestore();
    const { _setAuthForTest } = await import("./index.js");
    _setAuthForTest(null);
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it("空配列 → 空配列、fetch 呼ばれない", async () => {
    const { embedBatch } = await import("./index.js");
    expect(await embedBatch([])).toStrictEqual([]);
    expect(fetchSpy.mock.calls).toStrictEqual([]);
  });

  it("3 件 → 順序保持で結果配列を返す", async () => {
    const responses = [
      { embedding: { values: [10] } },
      { embedding: { values: [20] } },
      { embedding: { values: [30] } },
    ];
    let n = 0;
    fetchSpy.mockImplementation(async () => {
      const i = n++;
      return new Response(JSON.stringify(responses[i]), { status: 200 });
    });
    const { embedBatch, _setAuthForTest } = await import("./index.js");
    _setAuthForTest(makeFakeAuth());
    const out = await embedBatch(["a", "b", "c"], 1);
    // concurrency=1 で逐次実行 → 順序保持を厳密に検証
    expect(out).toStrictEqual([[10], [20], [30]]);
  });

  it("concurrency=1 で逐次、件数分 fetch 呼ばれる", async () => {
    fetchSpy.mockImplementation(
      async () => new Response(JSON.stringify({ embedding: { values: [0] } }), { status: 200 }),
    );
    const { embedBatch, _setAuthForTest } = await import("./index.js");
    _setAuthForTest(makeFakeAuth());
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
    const { embedBatch, _setAuthForTest } = await import("./index.js");
    _setAuthForTest(makeFakeAuth());
    await expect(embedBatch(["a", "b", "c"], 3)).rejects.toThrow(/500/);
  });
});

describe("constants", () => {
  it("model / dim / location を Vertex AI gemini-embedding-2 / 3072 / global で公開", async () => {
    const m = await import("./index.js");
    expect({
      model: m.EMBEDDING_MODEL,
      dim: m.EMBEDDING_DIMENSIONS,
      loc: m.EMBEDDING_LOCATION,
    }).toStrictEqual({
      model: "gemini-embedding-2",
      dim: 3072,
      loc: "global",
    });
  });
});
