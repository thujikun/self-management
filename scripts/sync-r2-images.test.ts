/**
 * `sync-r2-images.ts` の unit test。fetch / fs を fake で差替え、manifest fetch /
 * diff / upload orchestration を網羅する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business sync-r2-images の pure logic を fetch / fs fake で網羅 test。manifest fetch / diff / upload orchestration / dry-run / orphan 検出 / error 経路を inline で固定し、CI sync の挙動を保証する
 * @graph-connects none
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildLocalManifest,
  diffManifests,
  fetchRemoteManifest,
  mimeFromExt,
  normalizeManifest,
  putObject,
  r2ObjectUrl,
  runSync,
  walkFiles,
  type FetchLike,
  type ManifestV2,
} from "./sync-r2-images.js";

/**
 * 配列で fetch response を順番に返す fake。各 call で `requests` に method / url /
 * body / headers を記録する。
 *
 * @graph-connects none
 */
function fakeFetch(queue: { status: number; bodyText?: string; bodyBytes?: Uint8Array }[]): {
  fn: FetchLike;
  requests: { method: string; url: string; body: BodyInit | null | undefined; auth?: string }[];
} {
  const requests: {
    method: string;
    url: string;
    body: BodyInit | null | undefined;
    auth?: string;
  }[] = [];
  let i = 0;
  const fn: FetchLike = async (url, init) => {
    requests.push({
      method: init.method,
      url,
      body: init.body,
      auth: init.headers.Authorization,
    });
    const r = queue[i++];
    if (!r) throw new Error(`unexpected fetch call (queue exhausted) for ${init.method} ${url}`);
    const buf = r.bodyBytes ? r.bodyBytes : new TextEncoder().encode(r.bodyText ?? "");
    return {
      status: r.status,
      text: async () => r.bodyText ?? new TextDecoder().decode(buf),
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    };
  };
  return { fn, requests };
}

describe("mimeFromExt", () => {
  it.each([
    { ext: ".png", mime: "image/png" },
    { ext: ".JPG", mime: "image/jpeg" },
    { ext: ".svg", mime: "image/svg+xml" },
    { ext: ".unknown", mime: "application/octet-stream" },
  ])("$ext → $mime", ({ ext, mime }) => {
    expect(mimeFromExt(ext)).toBe(mime);
  });
});

describe("r2ObjectUrl", () => {
  it("account / bucket / key で正規 URL を組む (key は URL encode)", () => {
    expect(r2ObjectUrl("acc", "buc", "a/b.png")).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acc/r2/buckets/buc/objects/a%2Fb.png",
    );
  });
});

describe("walkFiles", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "sync-r2-walk-"));
    await mkdir(join(dir, "posts/slug"), { recursive: true });
    await writeFile(join(dir, "posts/slug/a.png"), "a");
    await writeFile(join(dir, "posts/slug/b.jpg"), "b");
    await writeFile(join(dir, "_skip.png"), "skip");
    await writeFile(join(dir, ".dotfile"), "dot");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("regular file のみ拾い、_ / . 始まりは skip、sort 済", async () => {
    const list = await walkFiles(dir);
    expect(list).toStrictEqual(["posts/slug/a.png", "posts/slug/b.jpg"]);
  });

  it("dir が存在しない場合は空配列", async () => {
    const list = await walkFiles(join(dir, "nope"));
    expect(list).toStrictEqual([]);
  });

  it("dir 以外 (regular file) を root に渡しても空配列", async () => {
    const list = await walkFiles(join(dir, "posts/slug/a.png"));
    expect(list).toStrictEqual([]);
  });
});

describe("buildLocalManifest", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "sync-r2-mani-"));
    await mkdir(join(dir, "x"), { recursive: true });
    await writeFile(join(dir, "x/a.png"), "hello");
    await writeFile(join(dir, "b.svg"), "world");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("file → sha256 hex の Record を返す", async () => {
    const m = await buildLocalManifest(dir);
    expect(m).toStrictEqual({
      "b.svg": "486ea46224d1bb4fb680f34f7c9ad96a8f24ec88be73ea8e5a6c65260e9cb8a7",
      "x/a.png": "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    });
  });
});

describe("normalizeManifest", () => {
  it("v2 shape はそのまま", () => {
    expect(normalizeManifest({ v: 2, local: { a: "x" }, orphans: ["old"] })).toStrictEqual({
      v: 2,
      local: { a: "x" },
      orphans: ["old"],
    });
  });

  it("v1 (flat Record) は local に展開 + orphans 空", () => {
    expect(normalizeManifest({ a: "x", b: "y" })).toStrictEqual({
      v: 2,
      local: { a: "x", b: "y" },
      orphans: [],
    });
  });

  it("v2 で orphans が array 不在なら 空 array に正規化", () => {
    expect(normalizeManifest({ v: 2, local: { a: "x" } })).toStrictEqual({
      v: 2,
      local: { a: "x" },
      orphans: [],
    });
  });

  it("orphans 内の非 string entry は除外", () => {
    expect(normalizeManifest({ v: 2, local: {}, orphans: ["k1", 42, null, "k2"] })).toStrictEqual({
      v: 2,
      local: {},
      orphans: ["k1", "k2"],
    });
  });

  it("object でない値は throw", () => {
    expect(() => normalizeManifest("oops")).toThrow(/not an object/);
    expect(() => normalizeManifest([])).toThrow(/not an object/);
    expect(() => normalizeManifest(null)).toThrow(/not an object/);
  });
});

describe("diffManifests", () => {
  it("add / change / orphan を分類", () => {
    const local = { a: "AAA", b: "BBB-new", c: "CCC" };
    const remote: ManifestV2 = { v: 2, local: { b: "BBB-old", d: "DDD" }, orphans: [] };
    expect(diffManifests(local, remote)).toStrictEqual({
      toUpload: ["a", "b", "c"],
      orphans: ["d"],
    });
  });

  it("完全一致 (local 同等) は toUpload 空 / orphans 空", () => {
    const local = { a: "X" };
    const remote: ManifestV2 = { v: 2, local: { a: "X" }, orphans: [] };
    expect(diffManifests(local, remote)).toStrictEqual({ toUpload: [], orphans: [] });
  });

  it("過去 manifest の orphans は local 戻ってなければ持ち越す", () => {
    const local = { a: "X" };
    const remote: ManifestV2 = { v: 2, local: { a: "X" }, orphans: ["old/x.png"] };
    expect(diffManifests(local, remote)).toStrictEqual({
      toUpload: [],
      orphans: ["old/x.png"],
    });
  });

  it("過去 orphan が local に戻ったら drop", () => {
    const local = { "x.png": "AAA" };
    const remote: ManifestV2 = { v: 2, local: {}, orphans: ["x.png"] };
    expect(diffManifests(local, remote)).toStrictEqual({
      toUpload: ["x.png"],
      orphans: [],
    });
  });

  it("過去 orphan + 新規 orphan は union (sort + dedupe)", () => {
    const local = {};
    const remote: ManifestV2 = {
      v: 2,
      local: { "new/orphan.png": "Z" },
      orphans: ["old/orphan.png", "new/orphan.png"],
    };
    expect(diffManifests(local, remote)).toStrictEqual({
      toUpload: [],
      orphans: ["new/orphan.png", "old/orphan.png"],
    });
  });
});

describe("fetchRemoteManifest", () => {
  it("200 (v1 flat) は v2 に正規化して返す", async () => {
    const { fn, requests } = fakeFetch([{ status: 200, bodyText: '{"a":"hash-a"}' }]);
    const m = await fetchRemoteManifest(fn, "acc", "buc", "tok");
    expect(m).toStrictEqual({ v: 2, local: { a: "hash-a" }, orphans: [] });
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.auth).toBe("Bearer tok");
    expect(requests[0]?.url).toContain("_manifest.json");
  });

  it("200 (v2) はそのまま", async () => {
    const v2 = { v: 2, local: { a: "x" }, orphans: ["k"] };
    const { fn } = fakeFetch([{ status: 200, bodyText: JSON.stringify(v2) }]);
    expect(await fetchRemoteManifest(fn, "acc", "buc", "tok")).toStrictEqual(v2);
  });

  it("404 は空 v2 manifest (初回 sync 想定)", async () => {
    const { fn } = fakeFetch([{ status: 404, bodyText: "not found" }]);
    expect(await fetchRemoteManifest(fn, "acc", "buc", "tok")).toStrictEqual({
      v: 2,
      local: {},
      orphans: [],
    });
  });

  it.each([400, 500, 403])("%d は throw", async (status) => {
    const { fn } = fakeFetch([{ status, bodyText: "err" }]);
    await expect(fetchRemoteManifest(fn, "acc", "buc", "tok")).rejects.toThrow(
      /manifest fetch failed/,
    );
  });

  it("manifest が object でない場合 throw", async () => {
    const { fn } = fakeFetch([{ status: 200, bodyText: '"not-an-object"' }]);
    await expect(fetchRemoteManifest(fn, "acc", "buc", "tok")).rejects.toThrow(/not an object/);
  });
});

describe("putObject", () => {
  it("PUT に body / Content-Type / Bearer を渡す", async () => {
    const { fn, requests } = fakeFetch([{ status: 200 }]);
    await putObject(fn, "acc", "buc", "tok", "x/a.png", new Uint8Array([1, 2, 3]), "image/png");
    expect(requests[0]?.method).toBe("PUT");
    expect(requests[0]?.auth).toBe("Bearer tok");
    expect(requests[0]?.url).toContain("x%2Fa.png");
  });

  it("non-2xx は throw (key 付き message)", async () => {
    const { fn } = fakeFetch([{ status: 500, bodyText: "boom" }]);
    await expect(
      putObject(fn, "acc", "buc", "tok", "k.png", new Uint8Array([0]), "image/png"),
    ).rejects.toThrow(/put failed \(k.png\): 500 boom/);
  });
});

describe("runSync", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "sync-r2-run-"));
    await mkdir(join(dir, "posts/slug"), { recursive: true });
    await writeFile(join(dir, "posts/slug/a.png"), Buffer.from([1, 2, 3]));
    await writeFile(join(dir, "posts/slug/b.svg"), Buffer.from([4, 5, 6]));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("初回 sync (manifest 404) で全 file を PUT、最後に manifest 更新", async () => {
    const { fn, requests } = fakeFetch([
      { status: 404 }, // GET _manifest.json
      { status: 200 }, // PUT a.png
      { status: 200 }, // PUT b.svg
      { status: 200 }, // PUT _manifest.json
    ]);
    const result = await runSync({
      fetchFn: fn,
      readFile: async (path) =>
        new Uint8Array(await (await import("node:fs/promises")).readFile(path)),
      imagesDir: dir,
      accountId: "acc",
      bucket: "buc",
      token: "tok",
      dryRun: false,
    });
    expect(result.uploaded).toStrictEqual(["posts/slug/a.png", "posts/slug/b.svg"]);
    expect(result.orphans).toStrictEqual([]);
    expect(requests).toHaveLength(4);
    expect(requests[0]?.method).toBe("GET");
    expect(requests[1]?.method).toBe("PUT");
    expect(requests[1]?.url).toContain("a.png");
    expect(requests[3]?.url).toContain("_manifest.json");
  });

  it("変更が無い場合は manifest 更新も skip", async () => {
    const localManifest = await buildLocalManifest(dir);
    const remoteV2: ManifestV2 = { v: 2, local: localManifest, orphans: [] };
    const { fn, requests } = fakeFetch([{ status: 200, bodyText: JSON.stringify(remoteV2) }]);
    const result = await runSync({
      fetchFn: fn,
      readFile: async () => new Uint8Array(),
      imagesDir: dir,
      accountId: "acc",
      bucket: "buc",
      token: "tok",
      dryRun: false,
    });
    expect(result.uploaded).toStrictEqual([]);
    expect(result.orphans).toStrictEqual([]);
    expect(requests).toHaveLength(1);
  });

  it("dry-run は実 PUT を skip して toUpload だけ返す", async () => {
    const { fn, requests } = fakeFetch([{ status: 404 }]);
    const result = await runSync({
      fetchFn: fn,
      readFile: async () => new Uint8Array(),
      imagesDir: dir,
      accountId: "acc",
      bucket: "buc",
      token: "tok",
      dryRun: true,
    });
    expect(result.uploaded).toStrictEqual(["posts/slug/a.png", "posts/slug/b.svg"]);
    expect(requests).toHaveLength(1);
  });

  it("orphan を新規観測した場合 manifest に永続化する", async () => {
    const remote: ManifestV2 = {
      v: 2,
      local: { "old/x.png": "deadbeef" },
      orphans: [],
    };
    const { fn, requests } = fakeFetch([
      { status: 200, bodyText: JSON.stringify(remote) },
      { status: 200 }, // PUT a.png
      { status: 200 }, // PUT b.svg
      { status: 200 }, // PUT manifest
    ]);
    const result = await runSync({
      fetchFn: fn,
      readFile: async (path) =>
        new Uint8Array(await (await import("node:fs/promises")).readFile(path)),
      imagesDir: dir,
      accountId: "acc",
      bucket: "buc",
      token: "tok",
      dryRun: false,
    });
    expect(result.orphans).toStrictEqual(["old/x.png"]);
    // manifest PUT の body を verify
    const manifestReq = requests.find(
      (r) => r.url.includes("_manifest.json") && r.method === "PUT",
    );
    expect(manifestReq).toBeDefined();
    const written = JSON.parse(
      new TextDecoder().decode(manifestReq?.body as Uint8Array),
    ) as ManifestV2;
    expect(written.v).toBe(2);
    expect(written.orphans).toStrictEqual(["old/x.png"]);
  });

  it("既知 orphan が persist (toUpload 0 でも manifest 更新済なら次回も orphans を返す)", async () => {
    // 2 件の image が完全同期済 (toUpload 0) で、過去 orphan が remote に残っている
    const localHashes = await buildLocalManifest(dir);
    const remote: ManifestV2 = {
      v: 2,
      local: localHashes,
      orphans: ["legacy/dead.png"],
    };
    const { fn, requests } = fakeFetch([{ status: 200, bodyText: JSON.stringify(remote) }]);
    const result = await runSync({
      fetchFn: fn,
      readFile: async () => new Uint8Array(),
      imagesDir: dir,
      accountId: "acc",
      bucket: "buc",
      token: "tok",
      dryRun: false,
    });
    // toUpload 0、orphans は前回観測分を持ち越し
    expect(result.uploaded).toStrictEqual([]);
    expect(result.orphans).toStrictEqual(["legacy/dead.png"]);
    // remote と同 orphan list なので manifest 更新は skip (1 request のみ)
    expect(requests).toHaveLength(1);
  });

  it("orphan list だけ変化した場合も manifest 更新する", async () => {
    const localHashes = await buildLocalManifest(dir);
    // remote.local が「過去にあったが今は消えた」 key を含む → newly observed orphan
    const remote: ManifestV2 = {
      v: 2,
      local: { ...localHashes, "removed.png": "ZZZ" },
      orphans: [],
    };
    const { fn, requests } = fakeFetch([
      { status: 200, bodyText: JSON.stringify(remote) },
      { status: 200 }, // PUT _manifest.json (orphan 観測 → 更新)
    ]);
    const result = await runSync({
      fetchFn: fn,
      readFile: async () => new Uint8Array(),
      imagesDir: dir,
      accountId: "acc",
      bucket: "buc",
      token: "tok",
      dryRun: false,
    });
    expect(result.uploaded).toStrictEqual([]);
    expect(result.orphans).toStrictEqual(["removed.png"]);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.url).toContain("_manifest.json");
  });
});
