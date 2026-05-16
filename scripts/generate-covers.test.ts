/**
 * generate-covers logic 層のテスト。
 *
 * 主に pure 関数 (`injectCoverLine` / `coverFilePath` / `coverPublicPath`) と、
 * 副作用ありの helper (`writeCoverIntoFrontmatter` / `generateCoverForPost` /
 * `generateAllCovers`) のスナップショット動作。後者は temp dir + fake font で
 * 実 satori + resvg を走らせる小さな integration として書く。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business generate-covers の logic test。injectCoverLine の surgical 編集 / coverPath helpers / 実 satori を回す generateCoverForPost / `_` 始まり fixture 除外を網羅
 * @graph-connects none
 */

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  PUBLIC_POSTS_DIR,
  coverFilePath,
  coverPublicPath,
  generateAllCovers,
  generateCoverForPost,
  injectCoverLine,
  writeCoverIntoFrontmatter,
} from "./generate-covers.js";

const FONT_CACHE = resolve(tmpdir(), "og-image-test-cache");

async function fetchCached(url: string, key: string): Promise<ArrayBuffer> {
  const p = resolve(FONT_CACHE, key);
  try {
    await stat(p);
    const buf = await readFile(p);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  } catch {
    // miss
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}`);
  const ab = await res.arrayBuffer();
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, Buffer.from(ab));
  return ab;
}

async function fakeFonts(): Promise<{ serif: ArrayBuffer; sans: ArrayBuffer }> {
  const [serif, sans] = await Promise.all([
    fetchCached(
      "https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-jp@5/files/noto-serif-jp-japanese-700-normal.woff",
      "noto-serif-jp.woff",
    ),
    fetchCached(
      "https://cdn.jsdelivr.net/npm/@fontsource/inter@5/files/inter-latin-500-normal.woff",
      "inter.woff",
    ),
  ]);
  return { serif, sans };
}

describe("injectCoverLine", () => {
  it("frontmatter 末尾に append (既存 cover 無し)", () => {
    const src = `---\ntitle: "x"\npublishedAt: "2026-01-01"\n---\n\nbody here\n`;
    const { next, updated } = injectCoverLine(src, "/posts/x.en.cover.png");
    expect(updated).toBe(true);
    expect(next).toContain('title: "x"');
    expect(next).toContain('publishedAt: "2026-01-01"');
    expect(next).toContain("cover: /posts/x.en.cover.png");
    expect(next).toContain("body here");
  });

  it("既存 cover 行を置換 (値が違う場合)", () => {
    const src = `---\ntitle: "x"\ncover: /posts/old.png\n---\n\nbody\n`;
    const { next, updated } = injectCoverLine(src, "/posts/new.png");
    expect(updated).toBe(true);
    expect(next).toContain("cover: /posts/new.png");
    expect(next).not.toContain("/posts/old.png");
  });

  it("既存 cover が同値なら no-op (updated=false)", () => {
    const src = `---\ntitle: "x"\ncover: /posts/x.png\n---\n\nbody\n`;
    const { next, updated } = injectCoverLine(src, "/posts/x.png");
    expect(updated).toBe(false);
    expect(next).toBe(src);
  });

  it("frontmatter 内の quote 形式 / multi-line summary は byte-for-byte で保存 (surgical)", () => {
    const src = [
      "---",
      'title: "social"',
      "summary: >-",
      "  multi line",
      "  summary content",
      "tags:",
      "  - one",
      "  - two",
      "---",
      "",
      "body",
      "",
    ].join("\n");
    const { next, updated } = injectCoverLine(src, "/posts/x.png");
    expect(updated).toBe(true);
    expect(next).toContain('title: "social"');
    expect(next).toContain("summary: >-");
    expect(next).toContain("  multi line");
    expect(next).toContain("  - one");
    expect(next).toContain("cover: /posts/x.png");
  });

  it("frontmatter block が無いソースは throw", () => {
    expect(() => injectCoverLine("no frontmatter here\n", "/x")).toThrow(/frontmatter/);
  });
});

describe("coverFilePath / coverPublicPath", () => {
  it("filesystem path は public/posts/ 配下 (絶対)", () => {
    const p = coverFilePath("foo", "ja");
    expect(p.startsWith(PUBLIC_POSTS_DIR)).toBe(true);
    expect(p.endsWith("/foo.ja.cover.png")).toBe(true);
  });

  it("public path は site-relative (/posts/...)", () => {
    expect(coverPublicPath("foo", "en")).toBe("/posts/foo.en.cover.png");
    expect(coverPublicPath("foo", "ja")).toBe("/posts/foo.ja.cover.png");
  });
});

describe("writeCoverIntoFrontmatter (file I/O)", () => {
  it("disk 上の md ファイルに cover を append し、再 invoke では no-op", async () => {
    const dir = resolve(tmpdir(), `og-test-fm-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const md = resolve(dir, "x.en.md");
    await writeFile(md, `---\ntitle: "x"\npublishedAt: "2026-01-01"\n---\n\nbody\n`, "utf8");

    const first = await writeCoverIntoFrontmatter(md, "/posts/x.en.cover.png");
    expect(first.updated).toBe(true);

    const second = await writeCoverIntoFrontmatter(md, "/posts/x.en.cover.png");
    expect(second.updated).toBe(false);

    const final = await readFile(md, "utf8");
    expect(final).toContain("cover: /posts/x.en.cover.png");
    // 1 回だけ書かれていること (二重 append にならない)
    expect((final.match(/cover:/g) ?? []).length).toBe(1);
  });
});

describe("generateCoverForPost / generateAllCovers (integration)", () => {
  it("frontmatter.cover を持つ post 1 件で PNG が public/posts/ に出る", async () => {
    const fonts = await fakeFonts();
    // tmp dir を public/posts/ に被せられないので、本物の PUBLIC_POSTS_DIR に書く。
    // テスト用 slug `__test-fixture-1` を使い、終了後に消す。
    const slug = `__test-fixture-${Date.now()}`;
    const result = await generateCoverForPost(
      {
        slug,
        lang: "en",
        meta: {
          title: "Tmp",
          publishedAt: "2026-01-01",
          tags: [],
          draft: false,
          syndication: {},
        },
        body: "",
      },
      fonts,
      { writeFrontmatter: false },
    );
    const buf = await readFile(result.pngPath);
    expect(buf.length).toBeGreaterThan(1000);
    expect(result.frontmatterUpdated).toBe(false);
    expect(result.publicPath).toBe(`/posts/${slug}.en.cover.png`);
    // cleanup
    const { rm } = await import("node:fs/promises");
    await rm(result.pngPath);
  });

  it("generateAllCovers は `_` 始まり fixture を除外 (slug 未指定時)", async () => {
    const fonts = await fakeFonts();
    const results = await generateAllCovers({
      posts: [
        {
          slug: "_skip-this",
          lang: "en",
          meta: {
            title: "x",
            publishedAt: "2026-01-01",
            tags: [],
            draft: false,
            syndication: {},
          },
          body: "",
        },
      ],
      fonts,
      writeFrontmatter: false,
    });
    expect(results).toStrictEqual([]);
  });

  it("generateAllCovers は slug filter で 1 件のみ通す (_ も明示指定なら通る)", async () => {
    const fonts = await fakeFonts();
    const slug = `__filter-${Date.now()}`;
    const results = await generateAllCovers({
      posts: [
        {
          slug,
          lang: "en",
          meta: {
            title: "x",
            publishedAt: "2026-01-01",
            tags: [],
            draft: false,
            syndication: {},
          },
          body: "",
        },
        {
          slug: "ignored",
          lang: "en",
          meta: {
            title: "y",
            publishedAt: "2026-01-01",
            tags: [],
            draft: false,
            syndication: {},
          },
          body: "",
        },
      ],
      fonts,
      slug,
      writeFrontmatter: false,
    });
    expect(results.length).toBe(1);
    expect(results[0].slug).toBe(slug);
    const { rm } = await import("node:fs/promises");
    await rm(results[0].pngPath);
  });
});
