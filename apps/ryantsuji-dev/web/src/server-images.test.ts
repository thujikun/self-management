/**
 * `server-images.ts` の unit test。R2Bucket interface を Map-backed fake で差替えて、
 * `r2KeyFromPath` の正常 / 異常 path、`serveImage` の Response 構造を inline で網羅する。
 *
 * 実 CF Workers binding に依存しないため、Node 上の vitest project (apps/ryantsuji-dev/web)
 * でそのまま実行できる。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business server-images の pure 関数を Map-backed R2 fake で網羅 test し、key
 * 抽出 / method 制限 / 404 / 200 / HEAD body 無しを構造的に保証する
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import {
  IMAGE_CACHE_CONTROL,
  r2KeyFromPath,
  serveImage,
  type R2BucketLike,
  type R2ObjectLike,
} from "./server-images.js";

/**
 * Map-backed R2 fake。put された key を get / head で引ける。
 *
 * @graph-connects none
 */
function fakeBucket(
  entries: Record<string, { body: Uint8Array; contentType?: string }>,
): R2BucketLike {
  function build(key: string): R2ObjectLike | null {
    const e = entries[key];
    if (!e) return null;
    const contentType = e.contentType;
    return {
      body: new Blob([new Uint8Array(e.body)]).stream(),
      httpEtag: `"${key}-etag"`,
      size: e.body.byteLength,
      httpMetadata: contentType ? { contentType } : undefined,
      writeHttpMetadata(headers: Headers): void {
        if (contentType) headers.set("Content-Type", contentType);
      },
    };
  }
  return {
    async get(key: string): Promise<R2ObjectLike | null> {
      return build(key);
    },
    async head(key: string): Promise<R2ObjectLike | null> {
      return build(key);
    },
  };
}

describe("r2KeyFromPath", () => {
  it.each([
    { path: "/images/foo.png", key: "foo.png" },
    { path: "/images/posts/slug/a.jpg", key: "posts/slug/a.jpg" },
    { path: "/images/deep/nested/dir/x.svg", key: "deep/nested/dir/x.svg" },
  ])("$path → $key", ({ path, key }) => {
    expect(r2KeyFromPath(path)).toBe(key);
  });

  it.each([
    { path: "/", desc: "root" },
    { path: "/image/foo.png", desc: "singular images prefix" },
    { path: "/images/", desc: "empty key" },
    { path: "/images/../secrets", desc: "parent traversal" },
    { path: "/images/./foo", desc: "self segment" },
    { path: "/posts/foo", desc: "non-images prefix" },
  ])("$path → null ($desc)", ({ path }) => {
    expect(r2KeyFromPath(path)).toBeNull();
  });
});

describe("serveImage", () => {
  it("GET /images/foo.png は 200 + Content-Type + Cache-Control + ETag を返す", async () => {
    const bucket = fakeBucket({
      "foo.png": { body: new Uint8Array([1, 2, 3, 4]), contentType: "image/png" },
    });
    const res = await serveImage(bucket, {
      method: "GET",
      url: "https://ryantsuji.dev/images/foo.png",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Content-Length")).toBe("4");
    expect(res.headers.get("ETag")).toBe('"foo.png-etag"');
    expect(res.headers.get("Cache-Control")).toBe(IMAGE_CACHE_CONTROL);
    expect(IMAGE_CACHE_CONTROL).toBe("public, max-age=31536000, immutable");
    expect(await res.arrayBuffer()).toEqual(new Uint8Array([1, 2, 3, 4]).buffer);
  });

  it("HEAD /images/foo.png は body 無し + 同 header を返す", async () => {
    const bucket = fakeBucket({
      "foo.png": { body: new Uint8Array([1, 2, 3, 4]), contentType: "image/png" },
    });
    const res = await serveImage(bucket, {
      method: "HEAD",
      url: "https://ryantsuji.dev/images/foo.png",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Content-Length")).toBe("4");
    expect(res.headers.get("ETag")).toBe('"foo.png-etag"');
    expect(res.headers.get("Cache-Control")).toBe(IMAGE_CACHE_CONTROL);
    expect(await res.arrayBuffer()).toEqual(new ArrayBuffer(0));
  });

  it("R2 に object が無い場合 404 plain text を返す", async () => {
    const bucket = fakeBucket({});
    const res = await serveImage(bucket, {
      method: "GET",
      url: "https://ryantsuji.dev/images/missing.png",
    });
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe("not found");
  });

  it("key 抽出に失敗する path は R2 を引かずに 404 を返す", async () => {
    const bucket: R2BucketLike = {
      async get(): Promise<R2ObjectLike | null> {
        throw new Error("should not be called");
      },
      async head(): Promise<R2ObjectLike | null> {
        throw new Error("should not be called");
      },
    };
    const res = await serveImage(bucket, {
      method: "GET",
      url: "https://ryantsuji.dev/images/../secrets",
    });
    expect(res.status).toBe(404);
  });

  it.each(["POST", "PUT", "DELETE", "PATCH"])("%s は 405 method not allowed を返す", async (m) => {
    const bucket = fakeBucket({});
    const res = await serveImage(bucket, {
      method: m,
      url: "https://ryantsuji.dev/images/foo.png",
    });
    expect(res.status).toBe(405);
  });

  it("R2 object に contentType 欠落時は application/octet-stream に fallback", async () => {
    const bucket = fakeBucket({
      "raw.bin": { body: new Uint8Array([9]) },
    });
    const res = await serveImage(bucket, {
      method: "GET",
      url: "https://ryantsuji.dev/images/raw.bin",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
  });
});
