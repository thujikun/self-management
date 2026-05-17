/**
 * `local-images.ts` の unit test。tmp dir に実 file を書いて handleImagesRequest を
 * 通し、status / headers / filePath を assert する。processImagesRequest / middleware
 * factory も mock req/res で網羅する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business local-images vite plugin の middleware 関数 + key 抽出 + mime lookup
 * を tmp file ベースで網羅 test し、dev /images/* 経路を fs から正しく serve できる
 * ことを保証する
 * @graph-connects none
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  handleImagesRequest,
  imageKeyFromPath,
  localImagesPlugin,
  makeImagesMiddleware,
  mimeFromExt,
  processImagesRequest,
} from "./local-images.js";

describe("imageKeyFromPath", () => {
  it.each([
    { path: "/images/foo.png", key: "foo.png" },
    { path: "/images/posts/slug/a.jpg", key: "posts/slug/a.jpg" },
  ])("$path → $key", ({ path, key }) => {
    expect(imageKeyFromPath(path)).toBe(key);
  });

  it.each([
    { path: "/", desc: "root" },
    { path: "/images/", desc: "empty key" },
    { path: "/images//etc/passwd", desc: "absolute path bypass attempt" },
    { path: "/images/../secrets", desc: "parent traversal" },
    { path: "/images/./foo", desc: "self segment" },
    { path: "/foo/bar", desc: "non-images prefix" },
  ])("$path → null ($desc)", ({ path }) => {
    expect(imageKeyFromPath(path)).toBeNull();
  });
});

describe("mimeFromExt", () => {
  it.each([
    { ext: ".png", mime: "image/png" },
    { ext: ".PNG", mime: "image/png" },
    { ext: ".jpg", mime: "image/jpeg" },
    { ext: ".jpeg", mime: "image/jpeg" },
    { ext: ".webp", mime: "image/webp" },
    { ext: ".avif", mime: "image/avif" },
    { ext: ".gif", mime: "image/gif" },
    { ext: ".svg", mime: "image/svg+xml" },
    { ext: ".ico", mime: "image/x-icon" },
  ])("$ext → $mime", ({ ext, mime }) => {
    expect(mimeFromExt(ext)).toBe(mime);
  });

  it("未知 ext は application/octet-stream", () => {
    expect(mimeFromExt(".xyz")).toBe("application/octet-stream");
  });
});

describe("handleImagesRequest", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "local-images-"));
    await mkdir(join(dir, "posts/slug"), { recursive: true });
    await writeFile(join(dir, "posts/slug/a.png"), Buffer.from([1, 2, 3, 4]));
    await writeFile(join(dir, "icon.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("GET /images/posts/slug/a.png → 200 + image/png + Content-Length", async () => {
    const r = await handleImagesRequest({
      imagesDir: dir,
      pathname: "/images/posts/slug/a.png",
      method: "GET",
    });
    expect(r.status).toBe(200);
    expect(r.headers["Content-Type"]).toBe("image/png");
    expect(r.headers["Content-Length"]).toBe("4");
    expect(r.headers["Cache-Control"]).toBe("no-cache");
    expect(r.filePath).toBe(join(dir, "posts/slug/a.png"));
  });

  it("HEAD /images/icon.svg → 200 + image/svg+xml", async () => {
    const r = await handleImagesRequest({
      imagesDir: dir,
      pathname: "/images/icon.svg",
      method: "HEAD",
    });
    expect(r.status).toBe(200);
    expect(r.headers["Content-Type"]).toBe("image/svg+xml");
    expect(r.filePath).toBe(join(dir, "icon.svg"));
  });

  it("存在しない path → 404", async () => {
    const r = await handleImagesRequest({
      imagesDir: dir,
      pathname: "/images/missing.png",
      method: "GET",
    });
    expect(r.status).toBe(404);
    expect(r.filePath).toBeNull();
  });

  it.each([
    { path: "/images/", desc: "empty key" },
    { path: "/images/../secrets", desc: "parent traversal" },
    { path: "/foo/bar", desc: "non-images prefix" },
  ])("$path → 404 ($desc)", async ({ path }) => {
    const r = await handleImagesRequest({
      imagesDir: dir,
      pathname: path,
      method: "GET",
    });
    expect(r.status).toBe(404);
    expect(r.filePath).toBeNull();
  });

  it.each(["POST", "PUT", "DELETE", "PATCH"])("%s → 405", async (m) => {
    const r = await handleImagesRequest({
      imagesDir: dir,
      pathname: "/images/posts/slug/a.png",
      method: m,
    });
    expect(r.status).toBe(405);
  });

  it("dir 内の directory に hit した場合 404 を返す (file ではない)", async () => {
    await mkdir(join(dir, "subdir"), { recursive: true });
    const r = await handleImagesRequest({
      imagesDir: dir,
      pathname: "/images/subdir",
      method: "GET",
    });
    expect(r.status).toBe(404);
    expect(r.filePath).toBeNull();
  });
});

/**
 * `ImagesMiddlewareRes` の minimal fake。setHeader / end の呼び出し履歴と statusCode
 * を観測する。
 *
 * @graph-connects none
 */
function fakeRes(): {
  res: { statusCode: number; setHeader(n: string, v: string): void; end(c?: string): void };
  headers: Record<string, string>;
  endedWith: string | undefined;
} {
  const headers: Record<string, string> = {};
  let endedWith: string | undefined;
  const res = {
    statusCode: 0,
    setHeader(n: string, v: string): void {
      headers[n] = v;
    },
    end(chunk?: string): void {
      endedWith = chunk;
    },
  };
  return {
    res,
    headers,
    get endedWith(): string | undefined {
      return endedWith;
    },
  };
}

describe("processImagesRequest", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "local-images-proc-"));
    await writeFile(join(dir, "a.png"), Buffer.from([1, 2, 3, 4]));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("GET hit: status 200 + headers + pipeFile が呼ばれる (end は呼ばれない)", async () => {
    const f = fakeRes();
    const pipeFile = vi.fn();
    await processImagesRequest({
      absDir: dir,
      req: { url: "/images/a.png", method: "GET" },
      res: f.res,
      pipeFile,
    });
    expect(f.res.statusCode).toBe(200);
    expect(f.headers["Content-Type"]).toBe("image/png");
    expect(pipeFile).toHaveBeenCalledWith(join(dir, "a.png"), f.res);
    expect(f.endedWith).toBeUndefined();
  });

  it("HEAD hit: status 200 + headers + body end (空文字)、pipe は呼ばない", async () => {
    const f = fakeRes();
    const pipeFile = vi.fn();
    await processImagesRequest({
      absDir: dir,
      req: { url: "/images/a.png", method: "HEAD" },
      res: f.res,
      pipeFile,
    });
    expect(f.res.statusCode).toBe(200);
    expect(pipeFile).not.toHaveBeenCalled();
    expect(f.endedWith).toBe("");
  });

  it("miss: status 404 + 'not found' で end", async () => {
    const f = fakeRes();
    const pipeFile = vi.fn();
    await processImagesRequest({
      absDir: dir,
      req: { url: "/images/missing.png", method: "GET" },
      res: f.res,
      pipeFile,
    });
    expect(f.res.statusCode).toBe(404);
    expect(f.endedWith).toBe("not found");
  });

  it("query string 付き url でも pathname 部分だけ評価する", async () => {
    const f = fakeRes();
    const pipeFile = vi.fn();
    await processImagesRequest({
      absDir: dir,
      req: { url: "/images/a.png?v=123", method: "GET" },
      res: f.res,
      pipeFile,
    });
    expect(f.res.statusCode).toBe(200);
    expect(pipeFile).toHaveBeenCalled();
  });

  it("req.url 未指定は 404", async () => {
    const f = fakeRes();
    const pipeFile = vi.fn();
    await processImagesRequest({
      absDir: dir,
      req: {},
      res: f.res,
      pipeFile,
    });
    expect(f.res.statusCode).toBe(404);
  });

  it("handleImagesRequest が throw した場合 500 + 'internal error'", async () => {
    const f = fakeRes();
    const pipeFile = vi.fn();
    // imagesDir を null に強制 → join() で TypeError 発火させ catch 経路を踏ませる。
    await processImagesRequest({
      absDir: null as unknown as string,
      req: { url: "/images/a.png", method: "GET" },
      res: f.res,
      pipeFile,
    });
    expect(f.res.statusCode).toBe(500);
    expect(f.endedWith).toBe("internal error");
  });
});

describe("makeImagesMiddleware", () => {
  it("/images/* 以外は next() に passthrough", () => {
    const mw = makeImagesMiddleware("/tmp/nope");
    const called = { next: false };
    mw({ url: "/posts/foo" } as Parameters<typeof mw>[0], {} as Parameters<typeof mw>[1], () => {
      called.next = true;
    });
    expect(called.next).toBe(true);
  });

  it("/images/* は processImagesRequest 経路に乗る (next 不発、async 完了で res に書く)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "local-images-mw-"));
    await writeFile(join(dir, "a.png"), Buffer.from([1, 2]));
    const mw = makeImagesMiddleware(dir);
    const ended: { value: string | undefined } = { value: undefined };
    const headers: Record<string, string> = {};
    let resolveEnd: () => void = () => {};
    const endPromise = new Promise<void>((resolve) => {
      resolveEnd = resolve;
    });
    const res = {
      statusCode: 0,
      setHeader(n: string, v: string): void {
        headers[n] = v;
      },
      end(chunk?: string): void {
        ended.value = chunk;
        resolveEnd();
      },
    };
    const nextSpy = vi.fn();
    mw(
      { url: "/images/a.png", method: "HEAD" } as Parameters<typeof mw>[0],
      res as unknown as Parameters<typeof mw>[1],
      nextSpy,
    );
    await endPromise;
    expect(nextSpy).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(headers["Content-Type"]).toBe("image/png");
    expect(ended.value).toBe("");
    await rm(dir, { recursive: true, force: true });
  });
});

describe("localImagesPlugin", () => {
  it("plugin factory が name + configureServer hook を返す", () => {
    const p = localImagesPlugin("/tmp/whatever");
    expect(p.name).toBe("ryantsuji-dev:local-images");
    expect(typeof p.configureServer).toBe("function");
  });

  it("configureServer が middleware を server.middlewares に install する", async () => {
    const plugin = localImagesPlugin("/tmp/whatever");
    const used: unknown[] = [];
    const fakeServer = {
      middlewares: {
        use(fn: unknown): void {
          used.push(fn);
        },
      },
    };
    const hook = plugin.configureServer as unknown as (server: typeof fakeServer) => unknown;
    await hook(fakeServer);
    expect(used).toHaveLength(1);
    expect(typeof used[0]).toBe("function");
  });
});
