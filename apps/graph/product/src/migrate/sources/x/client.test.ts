/**
 * `client.ts` の unit test (fetch を inject して network 無しで検証)。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business xFetch / xPaginate の OAuth1 + cursor pagination ロジックを fake fetch で検証。Authorization header / URL 組立 / next_token traversal を網羅
 * @graph-connects none
 */

import { describe, expect, it, vi } from "vitest";
import {
  bearerAuthHeader,
  buildUrl,
  defaultFetcher,
  mergePaginationToken,
  xFetch,
  xFetchBearer,
  xPaginate,
  xPaginateBearer,
  type FetchFn,
  type XPage,
} from "./client.js";
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
    for (const page of await xPaginate<{ id: string }>(creds, "/2/foo", {}, { fetcher: fetcher as FetchFn })) {
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
    for (const _ of await xPaginate(creds, "/2/foo", {}, { fetcher: fetcher as FetchFn })) {
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
    for (const _ of await xPaginate(creds, "/2/foo", {}, {
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
    for (const p of await xPaginate(creds, "/2/foo", {}, { fetcher: fetcher as FetchFn })) {
      pages.push(p);
    }
    expect(pages).toHaveLength(1);
    expect(pages[0].data).toEqual([]);
  });
});

describe("xFetchBearer", () => {
  it("attaches Bearer Authorization header and returns parsed JSON", async () => {
    const fetcher = vi.fn().mockReturnValue(fakeOk({ data: [{ id: "x" }] }));
    const out = await xFetchBearer<{ data: Array<{ id: string }> }>(
      "TOKEN123",
      "/2/users/me",
      {},
      fetcher as FetchFn,
    );
    expect(out.data[0].id).toBe("x");
    const init = fetcher.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe("Bearer TOKEN123");
  });

  it("throws on non-2xx with status + body excerpt", async () => {
    const fetcher = vi.fn().mockReturnValue(fakeErr(403, '{"detail":"forbidden"}'));
    await expect(xFetchBearer("T", "/2/foo", {}, fetcher as FetchFn)).rejects.toThrow(
      /403.*forbidden/,
    );
  });
});


describe("xPaginateBearer", () => {
  it("traverses pages via meta.next_token using Bearer auth", async () => {
    const pages = [
      { data: [{ id: "a" }], meta: { next_token: "t1" } },
      { data: [{ id: "b" }], meta: {} },
    ];
    let i = 0;
    const fetcher = vi.fn().mockImplementation(() => fakeOk(pages[i++]));
    const out: string[] = [];
    for (const p of await xPaginateBearer<{ id: string }>("T", "/2/foo", {}, {
      fetcher: fetcher as FetchFn,
    })) {
      out.push(...p.data.map((d) => d.id));
    }
    expect(out).toEqual(["a", "b"]);
  });

  it("respects maxPages with bearer auth", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(() => fakeOk({ data: [{ id: "x" }], meta: { next_token: "n" } }));
    let count = 0;
    for (const _ of await xPaginateBearer("T", "/2/foo", {}, {
      fetcher: fetcher as FetchFn,
      maxPages: 2,
    })) {
      count++;
    }
    expect(count).toBe(2);
  });

  it("yields empty data when response data is missing (Bearer)", async () => {
    const fetcher = vi.fn().mockReturnValue(fakeOk({ meta: {} }));
    const pages: Array<XPage<unknown>> = [];
    for (const p of await xPaginateBearer("T", "/2/foo", {}, { fetcher: fetcher as FetchFn })) {
      pages.push(p);
    }
    expect(pages[0].data).toEqual([]);
  });

  it("uses default fetcher (globalThis.fetch) when fetcher option omitted", async () => {
    const orig = globalThis.fetch;
    const stub = vi.fn().mockReturnValue(fakeOk({ data: [], meta: {} }));
    (globalThis as unknown as { fetch: FetchFn }).fetch = stub as FetchFn;
    try {
      for (const _ of await xPaginateBearer("T", "/2/foo")) {
        // consume
      }
      expect(stub).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = orig;
    }
  });
});

describe("defaultFetcher", () => {
  it("returns globalThis.fetch as FetchFn", () => {
    expect(typeof defaultFetcher()).toBe("function");
  });
});

describe("buildUrl", () => {
  it("returns base path when query is empty", () => {
    expect(buildUrl("/2/foo", {})).toBe("https://api.x.com/2/foo");
  });

  it("appends query string when params present", () => {
    expect(buildUrl("/2/foo", { a: "1", b: "2" })).toBe("https://api.x.com/2/foo?a=1&b=2");
  });
});

describe("bearerAuthHeader", () => {
  it("formats as 'Bearer {token}'", () => {
    expect(bearerAuthHeader("xyz")).toBe("Bearer xyz");
  });
});

describe("mergePaginationToken", () => {
  it("returns shallow copy of query when token undefined", () => {
    const q = { a: "1" };
    const out = mergePaginationToken(q, undefined);
    expect(out).toEqual({ a: "1" });
    expect(out).not.toBe(q);
  });

  it("adds pagination_token when present", () => {
    expect(mergePaginationToken({ a: "1" }, "TOK")).toEqual({ a: "1", pagination_token: "TOK" });
  });
});

describe("default fetcher fallback (no inject)", () => {
  it("xPaginate uses globalThis.fetch when fetcher option omitted", async () => {
    const orig = globalThis.fetch;
    const stub = vi.fn().mockReturnValue(fakeOk({ data: [], meta: {} }));
    (globalThis as unknown as { fetch: FetchFn }).fetch = stub as FetchFn;
    try {
      for (const _ of await xPaginate(creds, "/2/foo")) {
        // consume single empty page
      }
      expect(stub).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = orig;
    }
  });

});
