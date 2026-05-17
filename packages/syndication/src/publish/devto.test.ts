/**
 * `publishToDevto` の境界網羅。global `fetch` を mock して PUT request shape /
 * 429 retry / error throw / dry-run skip を検証する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business dev.to API publish 層の test。auth header / body shape / 429 retry / 非 429 error throw / dry-run skip を vi.spyOn(fetch) で網羅し、ネット I/O 無しで分岐を踏む
 * @graph-connects none
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DevtoArticleAttributes } from "../devto-frontmatter.js";
import { createDevtoArticle, publishToDevto } from "./devto.js";

const baseArticle: DevtoArticleAttributes = {
  title: "x",
  published: true,
  body_markdown: "# body",
  tags: ["ai"],
  canonical_url: "https://ryantsuji.dev/posts/x",
};

const okResponse = (json: object): Response =>
  new Response(JSON.stringify(json), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const rateLimitResponse = (): Response => new Response("Too Many Requests", { status: 429 });

describe("publishToDevto", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.useRealTimers();
  });

  it("dry-run は fetch を呼ばず擬似 URL を返す", async () => {
    const result = await publishToDevto({
      apiKey: "test-key",
      articleId: 123,
      article: baseArticle,
      dryRun: true,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.url).toContain("123");
    expect(result.url).toContain("dry-run");
  });

  it("200 OK で url と edited_at を返す + PUT /articles/<id> へ api-key 付きで投げる", async () => {
    fetchSpy.mockResolvedValueOnce(
      okResponse({ url: "https://dev.to/ryantsuji/x", edited_at: "2026-05-16T00:00:00Z" }),
    );
    const result = await publishToDevto({
      apiKey: "test-key",
      articleId: 123,
      article: baseArticle,
    });
    expect(result).toStrictEqual({
      url: "https://dev.to/ryantsuji/x",
      editedAt: "2026-05-16T00:00:00Z",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://dev.to/api/articles/123");
    expect((init as RequestInit).method).toBe("PUT");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["api-key"]).toBe("test-key");
    expect(headers["Content-Type"]).toBe("application/json");
    expect((init as RequestInit).body).toContain('"title":"x"');
  });

  it("429 が返ったら exponential backoff で retry (5 回上限)", async () => {
    fetchSpy
      .mockResolvedValueOnce(rateLimitResponse())
      .mockResolvedValueOnce(rateLimitResponse())
      .mockResolvedValueOnce(okResponse({ url: "https://dev.to/x", edited_at: null }));
    const sleeps: number[] = [];
    const result = await publishToDevto({
      apiKey: "test-key",
      articleId: 1,
      article: baseArticle,
      sleepFn: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(result.url).toBe("https://dev.to/x");
    expect(sleeps).toStrictEqual([2_000, 4_000]); // 1 回目 2s, 2 回目 4s
  });

  it("非 429 error は throw", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("not authorized", { status: 401 }));
    await expect(
      publishToDevto({ apiKey: "bad", articleId: 1, article: baseArticle }),
    ).rejects.toThrow(/401/);
  });

  it("429 が retry 上限を超えたら throw", async () => {
    for (let i = 0; i < 6; i++) fetchSpy.mockResolvedValueOnce(rateLimitResponse());
    await expect(
      publishToDevto({
        apiKey: "x",
        articleId: 1,
        article: baseArticle,
        sleepFn: () => Promise.resolve(),
      }),
    ).rejects.toThrow(/429/);
    // 5 回 retry + 6 回目で throw = fetch は 6 回呼ばれる
    expect(fetchSpy).toHaveBeenCalledTimes(6);
  });

  it("sleepFn 未指定時は default の setTimeout backoff を使う (retry 経路)", async () => {
    vi.useFakeTimers();
    fetchSpy
      .mockResolvedValueOnce(rateLimitResponse())
      .mockResolvedValueOnce(okResponse({ url: "https://dev.to/x", edited_at: null }));
    const promise = publishToDevto({
      apiKey: "test-key",
      articleId: 1,
      article: baseArticle,
    });
    // 1 回目 retry は 2_000ms 待つ。timer を進めて resolve させる。
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await promise;
    expect(result.url).toBe("https://dev.to/x");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("createDevtoArticle", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("201 で id + slug + url を返す + POST /api/articles へ api-key 付きで投げる", async () => {
    fetchSpy.mockResolvedValueOnce(
      okResponse({
        id: 9999,
        slug: "new-article-temp-slug-xxx",
        url: "https://dev.to/ryantsuji/new-article-temp-slug-xxx",
      }),
    );
    const result = await createDevtoArticle({ apiKey: "test-key", article: baseArticle });
    expect(result).toStrictEqual({
      id: 9999,
      slug: "new-article-temp-slug-xxx",
      url: "https://dev.to/ryantsuji/new-article-temp-slug-xxx",
    });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://dev.to/api/articles");
    expect((init as RequestInit).method).toBe("POST");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["api-key"]).toBe("test-key");
    expect((init as RequestInit).body).toContain('"title":"x"');
  });

  it("429 で retry (sleepFn 注入で即解決)", async () => {
    fetchSpy
      .mockResolvedValueOnce(rateLimitResponse())
      .mockResolvedValueOnce(
        okResponse({ id: 1, slug: "ok-slug", url: "https://dev.to/ryantsuji/ok-slug" }),
      );
    const sleeps: number[] = [];
    const result = await createDevtoArticle({
      apiKey: "x",
      article: baseArticle,
      sleepFn: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });
    expect(result.id).toBe(1);
    expect(sleeps).toStrictEqual([2_000]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("非 429 error は throw", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("forbidden", { status: 403 }));
    await expect(createDevtoArticle({ apiKey: "bad", article: baseArticle })).rejects.toThrow(
      /403/,
    );
  });

  it("429 retry 上限超で throw", async () => {
    for (let i = 0; i < 6; i++) fetchSpy.mockResolvedValueOnce(rateLimitResponse());
    await expect(
      createDevtoArticle({
        apiKey: "x",
        article: baseArticle,
        sleepFn: () => Promise.resolve(),
      }),
    ).rejects.toThrow(/429/);
    expect(fetchSpy).toHaveBeenCalledTimes(6);
  });
});
