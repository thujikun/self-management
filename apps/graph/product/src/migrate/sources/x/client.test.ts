/**
 * `client.ts` の unit test (fetch を inject して network 無しで検証)。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business xFetch / xPaginate の OAuth1 + cursor pagination ロジックを fake fetch で検証。Authorization header / URL 組立 / next_token traversal を網羅
 * @graph-connects none
 */

import { describe, expect, it, vi } from "vitest";
import { xFetch, xPaginate, type FetchFn, type XPage } from "./client.js";
import type { XCreds } from "./auth.js";

const creds: XCreds = {
  consumerKey: "ck",
  consumerSecret: "cs",
  accessToken: "at",
  accessTokenSecret: "ats",
};

function fakeOk(body: unknown): ReturnType<FetchFn> {
  return Promise.resolve({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
    json: async () => body,
  });
}

function fakeErr(status: number, body: string): ReturnType<FetchFn> {
  return Promise.resolve({
    ok: false,
    status,
    text: async () => body,
    json: async () => ({}),
  });
}

describe("xFetch", () => {
  it("attaches Authorization header (OAuth1) and returns parsed JSON", async () => {
    const fetcher = vi.fn().mockReturnValue(fakeOk({ data: [{ id: "1" }] }));
    const out = await xFetch<{ data: Array<{ id: string }> }>(
      creds,
      "/2/users/me",
      {},
      fetcher as FetchFn,
    );
    expect(out.data[0].id).toBe("1");
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.x.com/2/users/me");
    expect((init as { headers: Record<string, string> }).headers.Authorization).toMatch(
      /^OAuth /,
    );
  });

  it("appends query string when query params provided", async () => {
    const fetcher = vi.fn().mockReturnValue(fakeOk({ data: [] }));
    await xFetch(creds, "/2/users/123/tweets", { max_results: "100", expansions: "author_id" }, fetcher as FetchFn);
    const url = fetcher.mock.calls[0][0] as string;
    expect(url).toContain("max_results=100");
    expect(url).toContain("expansions=author_id");
  });

  it("throws on non-2xx including status + body excerpt", async () => {
    const fetcher = vi.fn().mockReturnValue(fakeErr(429, '{"detail":"too many"}'));
    await expect(xFetch(creds, "/2/foo", {}, fetcher as FetchFn)).rejects.toThrow(
      /429.*too many/,
    );
  });

  it("handles text() failure gracefully (still throws with status)", async () => {
    const fetcher = vi.fn().mockReturnValue(
      Promise.resolve({
        ok: false,
        status: 500,
        text: () => Promise.reject(new Error("network read error")),
        json: async () => ({}),
      }),
    );
    await expect(xFetch(creds, "/2/foo", {}, fetcher as FetchFn)).rejects.toThrow(/500/);
  });
});

describe("xPaginate", () => {
  it("traverses pages via meta.next_token until exhausted", async () => {
    const pages: Array<XPage<{ id: string }>> = [
      { data: [{ id: "a" }], meta: { next_token: "t1" } },
      { data: [{ id: "b" }], meta: { next_token: "t2" } },
      { data: [{ id: "c" }], meta: {} },
    ];
    let i = 0;
    const fetcher = vi.fn().mockImplementation(() => fakeOk(pages[i++]));
    const out: string[] = [];
    for await (const page of xPaginate<{ id: string }>(creds, "/2/foo", {}, { fetcher: fetcher as FetchFn })) {
      out.push(...page.data.map((d) => d.id));
    }
    expect(out).toEqual(["a", "b", "c"]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("passes pagination_token in subsequent requests", async () => {
    const pages: Array<XPage<{ id: string }>> = [
      { data: [{ id: "a" }], meta: { next_token: "TOK1" } },
      { data: [], meta: {} },
    ];
    let i = 0;
    const fetcher = vi.fn().mockImplementation(() => fakeOk(pages[i++]));
    for await (const _ of xPaginate(creds, "/2/foo", {}, { fetcher: fetcher as FetchFn })) {
      // consume
    }
    expect(fetcher.mock.calls[0][0] as string).not.toContain("pagination_token");
    expect(fetcher.mock.calls[1][0] as string).toContain("pagination_token=TOK1");
  });

  it("stops at maxPages even when next_token still present", async () => {
    const fetcher = vi.fn().mockImplementation(() =>
      fakeOk({ data: [{ id: "x" }], meta: { next_token: "neverend" } }),
    );
    let count = 0;
    for await (const _ of xPaginate(creds, "/2/foo", {}, {
      fetcher: fetcher as FetchFn,
      maxPages: 2,
    })) {
      count++;
    }
    expect(count).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("yields a single empty page when data is missing", async () => {
    const fetcher = vi.fn().mockReturnValue(fakeOk({ meta: {} }));
    const pages: Array<XPage<unknown>> = [];
    for await (const p of xPaginate(creds, "/2/foo", {}, { fetcher: fetcher as FetchFn })) {
      pages.push(p);
    }
    expect(pages).toHaveLength(1);
    expect(pages[0].data).toEqual([]);
  });
});
