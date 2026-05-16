/*
 * syndicate.ts pure logic + filesystem helper の test。
 *
 * resolver 構築 / filename parsing / `emit*` の slug / skip 分岐 / 出力 path
 * 構築までを tmpdir で網羅する。publish 経路 (Zenn git / dev.to API) は
 * `@self/syndication` 側の publish/*.test.ts で個別 test 済のため、ここでは
 * 「publish=true で API key 未設定なら throw」だけ確認する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business syndicate CLI logic の単体テスト。resolver / filename parser / emit* の filter 動作 / 出力 path を tmpdir で網羅し、CLI 経路の回帰を機械強制する
 * @graph-connects none
 */

import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseFrontmatter, type Frontmatter } from "@self/content";

import {
  buildDevtoResolver,
  buildZennResolver,
  emitDevto,
  emitZenn,
  parseFileName,
  readAllPosts,
  type ParsedPost,
} from "./syndicate.js";

function makeMeta(overrides: Record<string, unknown> = {}): Frontmatter {
  return parseFrontmatter({
    title: "title",
    publishedAt: "2026-01-01",
    ...overrides,
  });
}

function makePost(p: {
  slug: string;
  lang: "ja" | "en";
  zennId?: string;
  devto?: { id: number; slug: string };
  body?: string;
  cover?: string;
}): ParsedPost {
  const syndication: Record<string, unknown> = {};
  if (p.zennId) syndication.zenn = { id: p.zennId };
  if (p.devto) syndication.devto = p.devto;
  const metaInput: Record<string, unknown> = { syndication };
  if (p.cover) metaInput.cover = p.cover;
  return {
    slug: p.slug,
    lang: p.lang,
    meta: makeMeta(metaInput),
    body: p.body ?? "[link](/posts/other)\n",
  };
}

describe("parseFileName", () => {
  it("kebab-case slug + lang", () => {
    expect(parseFileName("foo-bar.ja.md")).toStrictEqual({ slug: "foo-bar", lang: "ja" });
    expect(parseFileName("foo-bar.en.md")).toStrictEqual({ slug: "foo-bar", lang: "en" });
  });

  it("digits prefix is allowed", () => {
    expect(parseFileName("17-mcp-servers.en.md")).toStrictEqual({
      slug: "17-mcp-servers",
      lang: "en",
    });
  });

  it("underscore prefix is allowed (fixture / draft pattern)", () => {
    expect(parseFileName("_minimal-fixture.en.md")).toStrictEqual({
      slug: "_minimal-fixture",
      lang: "en",
    });
  });

  it("uppercase letters are rejected per slug convention", () => {
    expect(parseFileName("Foo.ja.md")).toBeNull();
    expect(parseFileName("foo-Bar.en.md")).toBeNull();
    expect(parseFileName("FOO.JA.MD")).toBeNull();
  });

  it("unsupported lang is rejected", () => {
    expect(parseFileName("foo.fr.md")).toBeNull();
    expect(parseFileName("foo.zh.md")).toBeNull();
  });

  it("non-md / missing parts are rejected", () => {
    expect(parseFileName("foo.ja.txt")).toBeNull();
    expect(parseFileName(".ja.md")).toBeNull();
    expect(parseFileName("foo.md")).toBeNull();
    expect(parseFileName("foo")).toBeNull();
  });
});

describe("buildZennResolver", () => {
  it("maps .ja posts with zenn.id to aircloset publication URLs", () => {
    const posts = [
      makePost({ slug: "alpha", lang: "ja", zennId: "abc123" }),
      makePost({ slug: "beta", lang: "ja", zennId: "def456" }),
    ];
    const resolver = buildZennResolver(posts);
    expect(resolver("alpha")).toBe("https://zenn.dev/aircloset/articles/abc123");
    expect(resolver("beta")).toBe("https://zenn.dev/aircloset/articles/def456");
  });

  it("ignores .en posts and .ja posts missing zenn.id", () => {
    const posts = [
      makePost({ slug: "alpha", lang: "en", zennId: "abc123" }),
      makePost({ slug: "beta", lang: "ja" }),
    ];
    const resolver = buildZennResolver(posts);
    expect(resolver("alpha")).toBeNull();
    expect(resolver("beta")).toBeNull();
  });

  it("returns null for unknown slug", () => {
    const resolver = buildZennResolver([]);
    expect(resolver("missing")).toBeNull();
  });
});

describe("buildDevtoResolver", () => {
  it("maps .en posts with devto entry to dev.to/ryantsuji/<slug>", () => {
    const posts = [
      makePost({ slug: "alpha", lang: "en", devto: { id: 1, slug: "alpha-dev" } }),
      makePost({ slug: "beta", lang: "en", devto: { id: 2, slug: "beta-dev" } }),
    ];
    const resolver = buildDevtoResolver(posts);
    expect(resolver("alpha")).toBe("https://dev.to/ryantsuji/alpha-dev");
    expect(resolver("beta")).toBe("https://dev.to/ryantsuji/beta-dev");
  });

  it("ignores .ja posts and .en posts missing devto entry", () => {
    const posts = [
      makePost({ slug: "alpha", lang: "ja", devto: { id: 1, slug: "alpha-dev" } }),
      makePost({ slug: "beta", lang: "en" }),
    ];
    const resolver = buildDevtoResolver(posts);
    expect(resolver("alpha")).toBeNull();
    expect(resolver("beta")).toBeNull();
  });
});

describe("readAllPosts", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "syndicate-read-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const baseFm = (extra: string = "") =>
    `---\ntitle: t\npublishedAt: "2026-01-01"\n${extra}---\nbody\n`;

  it("loads parseable filenames and parses frontmatter", async () => {
    await writeFile(join(dir, "alpha.ja.md"), baseFm('syndication:\n  zenn:\n    id: "z1"\n'));
    await writeFile(
      join(dir, "alpha.en.md"),
      baseFm('syndication:\n  devto:\n    id: 1\n    slug: "alpha-dev"\n'),
    );

    const posts = await readAllPosts(dir);
    posts.sort((a, b) => `${a.slug}.${a.lang}`.localeCompare(`${b.slug}.${b.lang}`));
    expect(posts).toHaveLength(2);
    expect(posts[0].slug).toBe("alpha");
    expect(posts[0].lang).toBe("en");
    expect(posts[0].meta.syndication.devto).toStrictEqual({ id: 1, slug: "alpha-dev" });
    expect(posts[1].lang).toBe("ja");
    expect(posts[1].meta.syndication.zenn).toStrictEqual({ id: "z1" });
  });

  it("skips files whose name violates slug convention or lang set", async () => {
    await writeFile(join(dir, "Foo.ja.md"), baseFm()); // uppercase rejected
    await writeFile(join(dir, "ok.ja.md"), baseFm());
    await writeFile(join(dir, "README.md"), "not a post");
    const posts = await readAllPosts(dir);
    expect(posts.map((p) => p.slug)).toStrictEqual(["ok"]);
  });

  it("skips draft: true posts", async () => {
    await writeFile(join(dir, "alpha.ja.md"), baseFm("draft: true\n"));
    await writeFile(join(dir, "beta.ja.md"), baseFm());
    const posts = await readAllPosts(dir);
    expect(posts.map((p) => p.slug)).toStrictEqual(["beta"]);
  });
});

describe("emitZenn", () => {
  let outDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), "syndicate-zenn-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(async () => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    await rm(outDir, { recursive: true, force: true });
  });

  it("writes <zennId>.md for each .ja post with zenn.id", async () => {
    const posts = [
      makePost({ slug: "alpha", lang: "ja", zennId: "abc123", body: "hello\n" }),
      makePost({ slug: "beta", lang: "ja", zennId: "def456", body: "world\n" }),
    ];
    await emitZenn({ posts, outDir, footer: "", publish: false });
    const files = (await readdir(outDir)).sort();
    expect(files).toStrictEqual(["abc123.md", "def456.md"]);
    const alpha = await readFile(resolve(outDir, "abc123.md"), "utf8");
    expect(alpha).toContain('publication_name: "aircloset"');
    expect(alpha).toContain("hello");
  });

  it("skips .en posts even with zenn.id present (defensive)", async () => {
    const posts = [makePost({ slug: "alpha", lang: "en", zennId: "abc123" })];
    await emitZenn({ posts, outDir, footer: "", publish: false });
    expect(await readdir(outDir)).toStrictEqual([]);
  });

  it("filters to the requested slug when slug is set", async () => {
    const posts = [
      makePost({ slug: "alpha", lang: "ja", zennId: "abc123" }),
      makePost({ slug: "beta", lang: "ja", zennId: "def456" }),
    ];
    await emitZenn({ posts, outDir, footer: "", publish: false, slug: "alpha" });
    expect(await readdir(outDir)).toStrictEqual(["abc123.md"]);
  });

  it("warns and skips .ja posts missing zenn.id", async () => {
    const posts = [
      makePost({ slug: "alpha", lang: "ja" }),
      makePost({ slug: "beta", lang: "ja", zennId: "def456" }),
    ];
    await emitZenn({ posts, outDir, footer: "", publish: false });
    expect(await readdir(outDir)).toStrictEqual(["def456.md"]);
    expect(warnSpy).toHaveBeenCalledWith("  [skip] alpha.ja.md: no syndication.zenn.id");
  });
});

describe("emitDevto", () => {
  let outDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), "syndicate-devto-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(async () => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    await rm(outDir, { recursive: true, force: true });
  });

  it("writes <slug>.json with {id, article} for each .en post with devto entry", async () => {
    const posts = [
      makePost({
        slug: "alpha",
        lang: "en",
        devto: { id: 100, slug: "alpha-dev" },
        body: "hello\n",
      }),
      makePost({
        slug: "beta",
        lang: "en",
        devto: { id: 200, slug: "beta-dev" },
        body: "world\n",
      }),
    ];
    await emitDevto({ posts, outDir, publish: false });
    const files = (await readdir(outDir)).sort();
    expect(files).toStrictEqual(["alpha.json", "beta.json"]);
    const alphaJson = JSON.parse(await readFile(resolve(outDir, "alpha.json"), "utf8")) as {
      id: number;
      article: { canonical_url: string; body_markdown: string };
    };
    expect(alphaJson.id).toBe(100);
    expect(alphaJson.article.canonical_url).toBe("https://ryantsuji.dev/posts/alpha");
    expect(alphaJson.article.body_markdown).toContain("hello");
  });

  it("uses canonical host for cover image when post has cover", async () => {
    const posts = [
      makePost({
        slug: "alpha",
        lang: "en",
        devto: { id: 100, slug: "alpha-dev" },
        cover: "/posts/alpha.cover.png",
      }),
    ];
    await emitDevto({ posts, outDir, publish: false });
    const json = JSON.parse(await readFile(resolve(outDir, "alpha.json"), "utf8")) as {
      article: { cover_image?: string };
    };
    expect(json.article.cover_image).toBe("https://ryantsuji.dev/posts/alpha.cover.png");
  });

  it("skips .ja posts even with devto entry (defensive)", async () => {
    const posts = [makePost({ slug: "alpha", lang: "ja", devto: { id: 100, slug: "alpha-dev" } })];
    await emitDevto({ posts, outDir, publish: false });
    expect(await readdir(outDir)).toStrictEqual([]);
  });

  it("filters to the requested slug when slug is set", async () => {
    const posts = [
      makePost({ slug: "alpha", lang: "en", devto: { id: 100, slug: "alpha-dev" } }),
      makePost({ slug: "beta", lang: "en", devto: { id: 200, slug: "beta-dev" } }),
    ];
    await emitDevto({ posts, outDir, publish: false, slug: "beta" });
    expect(await readdir(outDir)).toStrictEqual(["beta.json"]);
  });

  it("warns and skips .en posts missing devto entry", async () => {
    const posts = [
      makePost({ slug: "alpha", lang: "en" }),
      makePost({ slug: "beta", lang: "en", devto: { id: 200, slug: "beta-dev" } }),
    ];
    await emitDevto({ posts, outDir, publish: false });
    expect(await readdir(outDir)).toStrictEqual(["beta.json"]);
    expect(warnSpy).toHaveBeenCalledWith("  [skip] alpha.en.md: no syndication.devto");
  });

  it("throws when publish=true and no API key is provided", async () => {
    const posts = [makePost({ slug: "alpha", lang: "en", devto: { id: 100, slug: "alpha-dev" } })];
    const prev = process.env.DEV_TO_API_KEY;
    delete process.env.DEV_TO_API_KEY;
    try {
      await expect(emitDevto({ posts, outDir, publish: true })).rejects.toThrowError(
        "--publish requires DEV_TO_API_KEY env",
      );
    } finally {
      if (prev !== undefined) process.env.DEV_TO_API_KEY = prev;
    }
  });
});
