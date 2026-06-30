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

// emit*({publish:true}) の publish 経路は実 git push / 実 dev.to API call を踏むので test
// では `@self/syndication` の publish/create 関数だけ mock 化する。syndicateForZenn /
// syndicateForDevto などの pure transform は実体をそのまま使う。
vi.mock("@self/syndication", async () => {
  const actual = await vi.importActual<typeof import("@self/syndication")>("@self/syndication");
  return {
    ...actual,
    createDevtoArticle: vi.fn(),
    publishToDevto: vi.fn(),
    publishToZenn: vi.fn(),
  };
});

import { createDevtoArticle, publishToDevto, publishToZenn } from "@self/syndication";

import {
  buildDevtoResolver,
  buildImageHashResolver,
  buildZennResolver,
  computeDevtoContentHash,
  emitDevto,
  emitZenn,
  extractDevtoSlugFromUrl,
  generateZennId,
  insertIntoExistingBlock,
  insertSyndicationBlock,
  parseFileName,
  readAllPosts,
  upsertDevtoContentHash,
  upsertDevtoSlug,
  writebackDevtoContentHashToFile,
  writebackDevtoSlugToFile,
  writebackDevtoToFile,
  writebackZennIdToFile,
  type ParsedPost,
} from "./syndicate.js";

const createDevtoArticleMock = vi.mocked(createDevtoArticle);
const publishToDevtoMock = vi.mocked(publishToDevto);
const publishToZennMock = vi.mocked(publishToZenn);

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
  devto?: { id: number; slug: string; contentHash?: string };
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

  it("draft field は schema で strip され runtime に届かない (旧 draft 概念廃止、 publishAt 1 本管理)", async () => {
    await writeFile(join(dir, "alpha.ja.md"), baseFm("draft: true\n"));
    await writeFile(join(dir, "beta.ja.md"), baseFm());
    const posts = await readAllPosts(dir);
    // 両方 readAllPosts に乗る (publishAt 過去判定は別経路の isPublishedNow が担当)
    expect(posts.map((p) => p.slug).sort()).toStrictEqual(["alpha", "beta"]);
  });

  it("`_` prefix slug (test fixture) は syndication 対象から除外", async () => {
    await writeFile(join(dir, "_fixture.ja.md"), baseFm());
    await writeFile(join(dir, "_minimal.en.md"), baseFm());
    await writeFile(join(dir, "real.ja.md"), baseFm());
    const posts = await readAllPosts(dir);
    expect(posts.map((p) => p.slug).sort()).toStrictEqual(["real"]);
  });

  it("excludeFromSyndication: true の post は syndication 対象から除外", async () => {
    await writeFile(join(dir, "internal.ja.md"), baseFm("excludeFromSyndication: true\n"));
    await writeFile(join(dir, "public.ja.md"), baseFm());
    const posts = await readAllPosts(dir);
    expect(posts.map((p) => p.slug).sort()).toStrictEqual(["public"]);
  });

  it("includeExcluded: true で excludeFromSyndication post も返す (non-syndicate 経路用)", async () => {
    await writeFile(join(dir, "internal.ja.md"), baseFm("excludeFromSyndication: true\n"));
    await writeFile(join(dir, "public.ja.md"), baseFm());
    const posts = await readAllPosts(dir, { includeExcluded: true });
    expect(posts.map((p) => p.slug).sort()).toStrictEqual(["internal", "public"]);
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
    expect(warnSpy).toHaveBeenCalledWith("  [skip] alpha.ja.md: no syndication.zenn.id (dry-run)");
  });

  it("args.now を全 post に forward して publishAt 境界判定を loop 全体で freeze", async () => {
    // Arrange: 同 now を共有する 2 post (publishAt 未来 / 過去)
    const future = makePost({ slug: "alpha", lang: "ja", zennId: "abc123" });
    future.meta = parseFrontmatter({
      title: "alpha",
      publishedAt: "2026-01-01",
      syndication: { zenn: { id: "abc123", publishAt: "2099-01-01T00:00:00Z" } },
    });
    const past = makePost({ slug: "beta", lang: "ja", zennId: "def456" });
    past.meta = parseFrontmatter({
      title: "beta",
      publishedAt: "2026-01-01",
      syndication: { zenn: { id: "def456", publishAt: "2020-01-01T00:00:00Z" } },
    });

    // Act: now を境界に置く
    await emitZenn({
      posts: [future, past],
      outDir,
      footer: "",
      publish: false,
      now: new Date("2026-05-18T00:00:00Z"),
    });

    // Assert: future → published: false, past → published: true
    const alpha = await readFile(resolve(outDir, "abc123.md"), "utf8");
    const beta = await readFile(resolve(outDir, "def456.md"), "utf8");
    expect(alpha).toContain("published: false");
    expect(beta).toContain("published: true");
  });

  it("meta.emoji を syndicateForZenn に thread して Zenn frontmatter の emoji 行に乗せる", async () => {
    // Arrange: per-post emoji を指定した .ja post
    const post = makePost({ slug: "alpha", lang: "ja", zennId: "abc123", body: "hello\n" });
    post.meta = parseFrontmatter({
      title: "alpha",
      publishedAt: "2026-01-01",
      emoji: "📊",
      syndication: { zenn: { id: "abc123" } },
    });

    // Act
    await emitZenn({ posts: [post], outDir, footer: "", publish: false });

    // Assert: 出力 markdown の frontmatter で per-post emoji が反映 (default 🤖 ではない)
    const alpha = await readFile(resolve(outDir, "abc123.md"), "utf8");
    expect(alpha).toContain('emoji: "📊"');
    expect(alpha).not.toContain('emoji: "🤖"');
  });

  it("meta.emoji 未指定なら syndicateForZenn 側の default 🤖 にフォールバック", async () => {
    // Arrange: emoji 未指定 (= meta.emoji が undefined)
    const post = makePost({ slug: "beta", lang: "ja", zennId: "def456", body: "world\n" });
    expect(post.meta.emoji).toBeUndefined();

    // Act
    await emitZenn({ posts: [post], outDir, footer: "", publish: false });

    // Assert: default 🤖 が出力される
    const beta = await readFile(resolve(outDir, "def456.md"), "utf8");
    expect(beta).toContain('emoji: "🤖"');
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
        cover: "/images/posts/alpha.cover.png",
      }),
    ];
    await emitDevto({ posts, outDir, publish: false });
    const json = JSON.parse(await readFile(resolve(outDir, "alpha.json"), "utf8")) as {
      article: { cover_image?: string };
    };
    expect(json.article.cover_image).toBe("https://ryantsuji.dev/images/posts/alpha.cover.png");
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
    expect(warnSpy).toHaveBeenCalledWith("  [skip] alpha.en.md: no syndication.devto.id (dry-run)");
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

  it("args.now を全 post に forward して publishAt 境界判定を loop 全体で freeze", async () => {
    // Arrange: 同 now を共有する 2 post (publishAt 未来 / 過去)
    const future = makePost({ slug: "alpha", lang: "en", devto: { id: 1, slug: "alpha-dev" } });
    future.meta = parseFrontmatter({
      title: "alpha",
      publishedAt: "2026-01-01",
      syndication: { devto: { id: 1, slug: "alpha-dev", publishAt: "2099-01-01T00:00:00Z" } },
    });
    const past = makePost({ slug: "beta", lang: "en", devto: { id: 2, slug: "beta-dev" } });
    past.meta = parseFrontmatter({
      title: "beta",
      publishedAt: "2026-01-01",
      syndication: { devto: { id: 2, slug: "beta-dev", publishAt: "2020-01-01T00:00:00Z" } },
    });

    // Act: now を境界に置く
    await emitDevto({
      posts: [future, past],
      outDir,
      publish: false,
      now: new Date("2026-05-18T00:00:00Z"),
    });

    // Assert: future → published: false, past → published: true
    const alphaJson = JSON.parse(await readFile(resolve(outDir, "alpha.json"), "utf8")) as {
      article: { published: boolean };
    };
    const betaJson = JSON.parse(await readFile(resolve(outDir, "beta.json"), "utf8")) as {
      article: { published: boolean };
    };
    expect(alphaJson.article.published).toBe(false);
    expect(betaJson.article.published).toBe(true);
  });
});

describe("insertSyndicationBlock", () => {
  const baseFm = `---\ntitle: t\npublishedAt: "2026-01-01"\n---\nbody\n`;

  it("frontmatter に syndication: が無い場合は closing --- 直前に新規 block を append する", () => {
    const updated = insertSyndicationBlock(baseFm, `  zenn:\n    id: "abc123"\n`);
    expect(updated).toMatchInlineSnapshot(`
      "---
      title: t
      publishedAt: "2026-01-01"
      syndication:
        zenn:
          id: "abc123"
      ---
      body
      "
    `);
  });

  it("既存 syndication: block がある場合は直後 (先頭) に sub-key を差し込む", () => {
    const input = `---\ntitle: t\nsyndication:\n  devto:\n    id: 100\n    slug: "old"\n---\nbody\n`;
    const updated = insertSyndicationBlock(input, `  zenn:\n    id: "abc123"\n`);
    expect(updated).toMatchInlineSnapshot(`
      "---
      title: t
      syndication:
        zenn:
          id: "abc123"
        devto:
          id: 100
          slug: "old"
      ---
      body
      "
    `);
  });

  it("markdown body 中の `syndication:` で始まる行には触らない (frontmatter 限定で操作)", () => {
    // 本 bug は元実装の `/^syndication:/m` が file 全体に multiline match して body 行を frontmatter 扱いしていた
    const input = [
      "---",
      "title: t",
      "---",
      "# YAML サンプル",
      "",
      "```yaml",
      "syndication:",
      "  foo: bar",
      "```",
      "",
    ].join("\n");
    const updated = insertSyndicationBlock(input, `  zenn:\n    id: "abc123"\n`);
    expect(updated).toMatchInlineSnapshot(`
      "---
      title: t
      syndication:
        zenn:
          id: "abc123"
      ---
      # YAML サンプル

      \`\`\`yaml
      syndication:
        foo: bar
      \`\`\`
      "
    `);
  });

  it("frontmatter delimiter が無い場合は throw", () => {
    expect(() => insertSyndicationBlock("plain markdown\n", `  zenn:\n    id: "x"\n`)).toThrow(
      /frontmatter delimiter/,
    );
  });
});

describe("insertIntoExistingBlock", () => {
  it("既存 devto block の先頭に行を挿入 (publishAt を温存)", () => {
    const fm = `title: t\nsyndication:\n  devto:\n    publishAt: "2026-05-26T07:00:00-07:00"\n`;
    const out = insertIntoExistingBlock(fm, "devto", `    id: 42\n    slug: "x"\n`);
    expect(out).toBe(
      `title: t\nsyndication:\n  devto:\n    id: 42\n    slug: "x"\n    publishAt: "2026-05-26T07:00:00-07:00"\n`,
    );
  });

  it("既存 zenn block の先頭に行を挿入 (publishAt を温存)", () => {
    const fm = `title: t\nsyndication:\n  zenn:\n    publishAt: "2026-05-26T08:30:00+09:00"\n`;
    const out = insertIntoExistingBlock(fm, "zenn", `    id: "abc123"\n`);
    expect(out).toBe(
      `title: t\nsyndication:\n  zenn:\n    id: "abc123"\n    publishAt: "2026-05-26T08:30:00+09:00"\n`,
    );
  });

  it("対象 block が無ければ null を返す (= 呼び出し側が新規作成へ fallback)", () => {
    const fm = `title: t\nsyndication:\n  zenn:\n    id: "x"\n`;
    expect(insertIntoExistingBlock(fm, "devto", `    id: 1\n`)).toBeNull();
  });

  it("syndication block 自体が無くても null (devto/zenn キー不在)", () => {
    expect(insertIntoExistingBlock(`title: t\n`, "devto", `    id: 1\n`)).toBeNull();
  });
});

describe("writebackZennIdToFile", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "syndicate-wbz-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("syndication: 不在 → frontmatter 末尾に新規 block を作って zenn.id を書く", async () => {
    const file = join(dir, "alpha.ja.md");
    await writeFile(file, `---\ntitle: t\npublishedAt: "2026-01-01"\n---\nhello\n`);
    await writebackZennIdToFile(file, "d9fc317c1336c2");
    const updated = await readFile(file, "utf8");
    expect(updated).toMatchInlineSnapshot(`
      "---
      title: t
      publishedAt: "2026-01-01"
      syndication:
        zenn:
          id: "d9fc317c1336c2"
      ---
      hello
      "
    `);
  });

  it("syndication: 既存 → 先頭に zenn sub-key を挿入する", async () => {
    const file = join(dir, "alpha.ja.md");
    await writeFile(
      file,
      `---\ntitle: t\nsyndication:\n  devto:\n    id: 1\n    slug: "alpha-dev"\n---\nhello\n`,
    );
    await writebackZennIdToFile(file, "d9fc317c1336c2");
    const updated = await readFile(file, "utf8");
    expect(updated).toMatchInlineSnapshot(`
      "---
      title: t
      syndication:
        zenn:
          id: "d9fc317c1336c2"
        devto:
          id: 1
          slug: "alpha-dev"
      ---
      hello
      "
    `);
  });
});

describe("writebackDevtoToFile", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "syndicate-wbd-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("syndication: 不在 → frontmatter 末尾に新規 block を作って devto.{id,slug} を書く", async () => {
    const file = join(dir, "alpha.en.md");
    await writeFile(file, `---\ntitle: t\npublishedAt: "2026-01-01"\n---\nhello\n`);
    await writebackDevtoToFile(file, 12345, "alpha-en-xxx");
    const updated = await readFile(file, "utf8");
    expect(updated).toMatchInlineSnapshot(`
      "---
      title: t
      publishedAt: "2026-01-01"
      syndication:
        devto:
          id: 12345
          slug: "alpha-en-xxx"
      ---
      hello
      "
    `);
  });

  it("syndication: 既存 (zenn.id あり) → 先頭に devto sub-key を挿入する", async () => {
    const file = join(dir, "alpha.en.md");
    await writeFile(file, `---\ntitle: t\nsyndication:\n  zenn:\n    id: "z1"\n---\nhello\n`);
    await writebackDevtoToFile(file, 12345, "alpha-en-xxx");
    const updated = await readFile(file, "utf8");
    expect(updated).toMatchInlineSnapshot(`
      "---
      title: t
      syndication:
        devto:
          id: 12345
          slug: "alpha-en-xxx"
        zenn:
          id: "z1"
      ---
      hello
      "
    `);
  });
});

describe("generateZennId", () => {
  it("14 文字 lowercase hex を返す (crypto.randomBytes(7) → hex)", () => {
    const id = generateZennId();
    expect(id).toMatch(/^[a-f0-9]{14}$/);
    expect(id).toHaveLength(14);
  });

  it("呼び出しごとに異なる id を返す (= 衝突確率 1/16^14)", () => {
    const ids = new Set(Array.from({ length: 16 }, () => generateZennId()));
    expect(ids.size).toBe(16);
  });
});

describe("buildImageHashResolver", () => {
  let contentDir: string;

  beforeEach(async () => {
    contentDir = await mkdtemp(join(tmpdir(), "syndicate-img-hash-"));
  });
  afterEach(async () => {
    await rm(contentDir, { recursive: true, force: true });
  });

  it("画像 file の sha256 prefix (8 hex chars) を返す", async () => {
    const { mkdir: mkdirP } = await import("node:fs/promises");
    await mkdirP(join(contentDir, "images", "posts", "demo"), { recursive: true });
    await writeFile(join(contentDir, "images", "posts", "demo", "a.png"), "alpha-bytes");
    const resolver = buildImageHashResolver(contentDir);
    const hash = resolver("/images/posts/demo/a.png");
    expect(hash).toMatch(/^[a-f0-9]{8}$/);
  });

  it("同じ画像を 2 回引いても同じ hash + file は 1 度しか read しない (cache hit)", async () => {
    // cache hit を間接証明する: 1 回目 resolve した後に file 内容を書き換え、
    // それでも 2 回目が h1 と一致することで「読み直していない (= cache hit)」を保証する。
    // 単純な toStrictEqual(h1) では cache 経路が壊れても pass してしまうため、
    // ここで書き換えを挟んで cache 分岐の regression を捕まえる。
    const { mkdir: mkdirP } = await import("node:fs/promises");
    await mkdirP(join(contentDir, "images"), { recursive: true });
    const imgPath = join(contentDir, "images", "x.png");
    await writeFile(imgPath, "same-bytes");
    const resolver = buildImageHashResolver(contentDir);
    const h1 = resolver("/images/x.png");
    expect(h1).toMatch(/^[a-f0-9]{8}$/);
    await writeFile(imgPath, "different-bytes-that-would-yield-different-hash");
    const h2 = resolver("/images/x.png");
    expect(h2).toStrictEqual(h1);
  });

  it("内容が違えば違う hash を返す", async () => {
    const { mkdir: mkdirP } = await import("node:fs/promises");
    await mkdirP(join(contentDir, "images"), { recursive: true });
    await writeFile(join(contentDir, "images", "p.png"), "content-1");
    await writeFile(join(contentDir, "images", "q.png"), "content-2-different");
    const resolver = buildImageHashResolver(contentDir);
    expect(resolver("/images/p.png")).not.toBe(resolver("/images/q.png"));
  });

  it("ファイル不在は null を返す (rewriteImageLinks 側で素通り)", () => {
    const resolver = buildImageHashResolver(contentDir);
    expect(resolver("/images/missing.png")).toBeNull();
  });

  it("`/images/` で始まらない path は null", () => {
    const resolver = buildImageHashResolver(contentDir);
    expect(resolver("posts/foo.png")).toBeNull();
    expect(resolver("/assets/foo.png")).toBeNull();
  });
});

describe("emitZenn publish create branch", () => {
  let outDir: string;
  let postsDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), "syndicate-zpub-out-"));
    postsDir = await mkdtemp(join(tmpdir(), "syndicate-zpub-src-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    createDevtoArticleMock.mockReset();
    publishToDevtoMock.mockReset();
    publishToZennMock.mockReset();
  });
  afterEach(async () => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    await rm(outDir, { recursive: true, force: true });
    await rm(postsDir, { recursive: true, force: true });
  });

  it("id 不在の .ja post を publish: 新規 zenn id 生成 → writeback → publishToZenn を実行", async () => {
    publishToZennMock.mockResolvedValueOnce({
      filePath: "/fake/articles/xxx.md",
      commitSha: "deadbeef0123",
      pushed: true,
    });
    const srcFile = join(postsDir, "alpha.ja.md");
    await writeFile(srcFile, `---\ntitle: t\npublishedAt: "2026-01-01"\n---\nhello\n`);
    const posts = [makePost({ slug: "alpha", lang: "ja", body: "hello\n" })];

    await emitZenn({ posts, outDir, footer: "", publish: true, postsDir, repoDir: "/fake/repo" });

    // writeback で zenn id が src file に書かれる (id 自体は randomBytes 由来で非決定的)
    const after = await readFile(srcFile, "utf8");
    expect(after).toMatch(/zenn:\n {4}id: "[a-f0-9]{14}"/);
    const idMatch = /zenn:\n {4}id: "([a-f0-9]{14})"/.exec(after);
    if (!idMatch) throw new Error(`zenn.id not extracted from ${JSON.stringify(after)}`);
    const generatedId = idMatch[1] as string;
    // 出力 file 名は <zennId>.md
    expect(await readdir(outDir)).toStrictEqual([`${generatedId}.md`]);
    // publishToZenn が同 id で 1 回呼ばれる
    expect(publishToZennMock).toHaveBeenCalledTimes(1);
    const publishArg = publishToZennMock.mock.calls[0]?.[0];
    expect(publishArg).toMatchObject({
      repoDir: "/fake/repo",
      remoteUrl: "git@github.com:thujikun/ryantsuji-dev-content.git",
      zennId: generatedId,
      commitSubject: `chore: sync alpha (${generatedId})`,
    });
    expect(publishArg?.markdown).toMatch(/hello/);
  });

  it("zenn block が publishAt だけ (id 未設定 = 予約済未作成) の .ja post を publish: id 生成 → 後挿入し publishAt を温存", async () => {
    publishToZennMock.mockResolvedValueOnce({
      filePath: "/fake/articles/yyy.md",
      commitSha: "feedface4567",
      pushed: true,
    });
    const srcFile = join(postsDir, "delta.ja.md");
    await writeFile(
      srcFile,
      `---\ntitle: t\npublishedAt: "2026-01-01"\nsyndication:\n  zenn:\n    publishAt: "2099-01-01T08:30:00+09:00"\n---\nhello\n`,
    );
    const post = makePost({ slug: "delta", lang: "ja", body: "hello\n" });
    post.meta = parseFrontmatter({
      title: "t",
      publishedAt: "2026-01-01",
      syndication: { zenn: { publishAt: "2099-01-01T08:30:00+09:00" } },
    });

    await emitZenn({
      posts: [post],
      outDir,
      footer: "",
      publish: true,
      postsDir,
      repoDir: "/fake/repo",
    });

    // 生成 id が zenn block 先頭に挿入され、既存 publishAt は残る
    const after = await readFile(srcFile, "utf8");
    expect(after).toMatch(
      /syndication:\n {2}zenn:\n {4}id: "[a-f0-9]{14}"\n {4}publishAt: "2099-01-01T08:30:00\+09:00"\n/u,
    );
    expect(publishToZennMock).toHaveBeenCalledTimes(1);
  });
});

describe("emitDevto publish create branch", () => {
  let outDir: string;
  let postsDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), "syndicate-dpub-out-"));
    postsDir = await mkdtemp(join(tmpdir(), "syndicate-dpub-src-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    createDevtoArticleMock.mockReset();
    publishToDevtoMock.mockReset();
    publishToZennMock.mockReset();
  });
  afterEach(async () => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    await rm(outDir, { recursive: true, force: true });
    await rm(postsDir, { recursive: true, force: true });
  });

  it("devto 不在の .en post を publish: createDevtoArticle → writeback → PUT は skip", async () => {
    createDevtoArticleMock.mockResolvedValueOnce({
      id: 12345,
      slug: "alpha-en-xxx",
      url: "https://dev.to/ryantsuji/alpha-en-xxx",
    });
    const srcFile = join(postsDir, "alpha.en.md");
    await writeFile(srcFile, `---\ntitle: t\npublishedAt: "2026-01-01"\n---\nhello\n`);
    const posts = [makePost({ slug: "alpha", lang: "en", body: "hello\n" })];

    await emitDevto({
      posts,
      outDir,
      publish: true,
      apiKey: "test-key",
      postsDir,
    });

    // writeback で devto.{id, slug, contentHash} が src file に書かれる
    const after = await readFile(srcFile, "utf8");
    expect(after).toMatch(
      /syndication:\n {2}devto:\n {4}id: 12345\n {4}slug: "alpha-en-xxx"\n {4}contentHash: "[a-f0-9]{16}"\n/u,
    );
    // 出力 JSON は新規 id で書かれる
    const written = JSON.parse(await readFile(resolve(outDir, "alpha.json"), "utf8")) as {
      id: number;
    };
    expect(written.id).toStrictEqual(12345);
    // POST 直後の body と PUT body が同一なので二度叩きしない (Major #4)
    expect(createDevtoArticleMock).toHaveBeenCalledTimes(1);
    expect(publishToDevtoMock).not.toHaveBeenCalled();
  });

  it("devto block が publishAt だけ (id 未設定 = 予約済未作成) の .en post を publish: POST 作成 → id/slug を後挿入し publishAt を温存", async () => {
    createDevtoArticleMock.mockResolvedValueOnce({
      id: 67890,
      slug: "delta-en-yyy",
      url: "https://dev.to/ryantsuji/delta-en-yyy",
    });
    const srcFile = join(postsDir, "delta.en.md");
    // publishAt だけ予約済、id/slug は未設定の状態 (= cortex-auto-review が踏むケース)
    await writeFile(
      srcFile,
      `---\ntitle: t\npublishedAt: "2026-01-01"\nsyndication:\n  devto:\n    publishAt: "2099-01-01T07:00:00-07:00"\n---\nhello\n`,
    );
    const post = makePost({ slug: "delta", lang: "en", body: "hello\n" });
    post.meta = parseFrontmatter({
      title: "t",
      publishedAt: "2026-01-01",
      syndication: { devto: { publishAt: "2099-01-01T07:00:00-07:00" } },
    });
    const posts = [post];

    await emitDevto({ posts, outDir, publish: true, apiKey: "test-key", postsDir });

    expect(createDevtoArticleMock).toHaveBeenCalledTimes(1);
    expect(publishToDevtoMock).not.toHaveBeenCalled();
    // id/slug/contentHash が devto block 先頭に挿入され、既存 publishAt は残る
    const after = await readFile(srcFile, "utf8");
    expect(after).toMatch(
      /syndication:\n {2}devto:\n {4}id: 67890\n {4}slug: "delta-en-yyy"\n {4}contentHash: "[a-f0-9]{16}"\n {4}publishAt: "2099-01-01T07:00:00-07:00"\n/u,
    );
  });

  it("devto 既存だが contentHash 未設定の .en post を publish: PUT で update して contentHash 書き戻し", async () => {
    publishToDevtoMock.mockResolvedValueOnce({
      url: "https://dev.to/ryantsuji/beta",
      editedAt: "2026-05-17T00:00:00Z",
    });
    const srcFile = join(postsDir, "beta.en.md");
    await writeFile(
      srcFile,
      `---\ntitle: t\npublishedAt: "2026-01-01"\nsyndication:\n  devto:\n    id: 999\n    slug: "beta-existing"\n---\nworld\n`,
    );
    const posts = [
      makePost({
        slug: "beta",
        lang: "en",
        devto: { id: 999, slug: "beta-existing" },
        body: "world\n",
      }),
    ];

    await emitDevto({
      posts,
      outDir,
      publish: true,
      apiKey: "test-key",
      postsDir,
    });

    expect(createDevtoArticleMock).not.toHaveBeenCalled();
    expect(publishToDevtoMock).toHaveBeenCalledTimes(1);
    expect(publishToDevtoMock.mock.calls[0]?.[0]).toMatchObject({
      apiKey: "test-key",
      articleId: 999,
    });
    const after = await readFile(srcFile, "utf8");
    expect(after).toMatch(/ {4}contentHash: "[a-f0-9]{16}"/u);
  });

  it("PUT 応答 url の slug が stored と差分があれば frontmatter slug を reconcile", async () => {
    // dev.to が draft → 公開時に temp-slug を剥がしたケースを再現。stored は temp-slug
    // 付き、PUT 応答 url は canonical slug を返す。
    publishToDevtoMock.mockResolvedValueOnce({
      url: "https://dev.to/ryantsuji/zeta-canonical-slug",
      editedAt: "2026-05-17T00:00:00Z",
    });
    const srcFile = join(postsDir, "zeta.en.md");
    await writeFile(
      srcFile,
      `---\ntitle: t\npublishedAt: "2026-01-01"\nsyndication:\n  devto:\n    id: 111\n    slug: "zeta-stale-temp-slug-9999"\n---\nzeta body\n`,
    );
    const posts = [
      makePost({
        slug: "zeta",
        lang: "en",
        devto: { id: 111, slug: "zeta-stale-temp-slug-9999" },
        body: "zeta body\n",
      }),
    ];

    await emitDevto({
      posts,
      outDir,
      publish: true,
      apiKey: "test-key",
      postsDir,
    });

    expect(publishToDevtoMock).toHaveBeenCalledTimes(1);
    const after = await readFile(srcFile, "utf8");
    // stale な temp-slug 付きは消え、canonical slug に置き換わる
    expect(after).toContain('    slug: "zeta-canonical-slug"');
    expect(after).not.toContain("temp-slug-9999");
    // body は触らない
    expect(after).toContain("zeta body\n");
  });

  it("PUT 応答 url の slug が stored と一致するなら slug は書き換えない (idempotency)", async () => {
    publishToDevtoMock.mockResolvedValueOnce({
      url: "https://dev.to/ryantsuji/eta-same-slug",
      editedAt: "2026-05-17T00:00:00Z",
    });
    const srcFile = join(postsDir, "eta.en.md");
    await writeFile(
      srcFile,
      `---\ntitle: t\npublishedAt: "2026-01-01"\nsyndication:\n  devto:\n    id: 222\n    slug: "eta-same-slug"\n---\neta body\n`,
    );
    const posts = [
      makePost({
        slug: "eta",
        lang: "en",
        devto: { id: 222, slug: "eta-same-slug" },
        body: "eta body\n",
      }),
    ];

    await emitDevto({
      posts,
      outDir,
      publish: true,
      apiKey: "test-key",
      postsDir,
    });

    const after = await readFile(srcFile, "utf8");
    // slug 行は元のまま、ファイル全体に slug 1 行だけ
    expect(after.match(/^ {4}slug:/gmu)).toHaveLength(1);
    expect(after).toContain('    slug: "eta-same-slug"');
  });

  it("devto 既存 + contentHash 一致なら PUT を skip (= 毎 cron tick で edited_at が bump しない)", async () => {
    // Arrange: contentHash を 「いま computeDevtoContentHash で出る hash」に予め設定
    const posts = [
      makePost({
        slug: "gamma",
        lang: "en",
        devto: { id: 555, slug: "gamma-existing" },
        body: "gamma body\n",
      }),
    ];
    // emitDevto と同じ builder で article を構築して hash を逆算
    const { syndicateForDevto } =
      await vi.importActual<typeof import("@self/syndication")>("@self/syndication");
    const article = syndicateForDevto({
      meta: posts[0]!.meta,
      body: posts[0]!.body,
      slug: posts[0]!.slug,
      resolver: () => null,
      canonicalHost: "https://ryantsuji.dev",
      coverImageUrl: undefined,
      now: new Date("2026-05-21T00:00:00Z"),
    });
    const matchingHash = computeDevtoContentHash(article);
    // contentHash を post に inject (= 「直近 PUT 後の repo 状態」を再現)
    posts[0]!.meta.syndication.devto!.contentHash = matchingHash;

    await emitDevto({
      posts,
      outDir,
      publish: true,
      apiKey: "test-key",
      postsDir,
      now: new Date("2026-05-21T00:00:00Z"),
    });

    expect(publishToDevtoMock).not.toHaveBeenCalled();
  });
});

describe("computeDevtoContentHash", () => {
  const baseArticle = {
    title: "alpha",
    published: true,
    body_markdown: "hello world",
    tags: ["a", "b"],
    canonical_url: "https://ryantsuji.dev/posts/alpha",
  };

  it("同 article から決定的に 16 文字の hex prefix を返す", () => {
    const h = computeDevtoContentHash(baseArticle);
    expect(h).toMatch(/^[a-f0-9]{16}$/u);
    expect(computeDevtoContentHash(baseArticle)).toBe(h);
  });

  it("body が変わると hash も変わる", () => {
    const a = computeDevtoContentHash(baseArticle);
    const b = computeDevtoContentHash({ ...baseArticle, body_markdown: "hello world!" });
    expect(a).not.toBe(b);
  });

  it("published 切替 (publishAt 境界をまたぐ) で hash が変わる", () => {
    const a = computeDevtoContentHash({ ...baseArticle, published: false });
    const b = computeDevtoContentHash({ ...baseArticle, published: true });
    expect(a).not.toBe(b);
  });
});

describe("upsertDevtoContentHash", () => {
  const fmWithDevto = [
    "title: t",
    "syndication:",
    "  devto:",
    "    id: 1",
    '    slug: "alpha-dev"',
  ].join("\n");

  it("contentHash 未設定なら slug の直後に新規行を挿入", () => {
    const out = upsertDevtoContentHash(fmWithDevto, "abc1234567890def");
    expect(out).toContain('    slug: "alpha-dev"\n    contentHash: "abc1234567890def"');
  });

  it("contentHash 既存なら値だけ書き換え (1 行 + 重複なし)", () => {
    const fmWithHash = `${fmWithDevto}\n    contentHash: "OLD0000000000000"`;
    const out = upsertDevtoContentHash(fmWithHash, "NEW1111111111111");
    expect(out).toContain('    contentHash: "NEW1111111111111"');
    expect(out).not.toContain("OLD0000000000000");
    expect(out.match(/contentHash:/gu)).toHaveLength(1);
  });

  it("devto.slug 行が無い frontmatter には throw (devto: block 自体不在 = 呼ぶ前に gate するべき)", () => {
    const fmNoDevto = ["title: t", "syndication:", "  zenn:", '    id: "xyz"'].join("\n");
    expect(() => upsertDevtoContentHash(fmNoDevto, "abc")).toThrowError(
      /syndication.devto.slug line not found/u,
    );
  });
});

describe("writebackDevtoContentHashToFile", () => {
  let postsDir: string;

  beforeEach(async () => {
    postsDir = await mkdtemp(join(tmpdir(), "syndicate-hash-wb-"));
  });
  afterEach(async () => {
    await rm(postsDir, { recursive: true, force: true });
  });

  it("既存 devto block に contentHash 行を追記", async () => {
    const file = join(postsDir, "delta.en.md");
    await writeFile(
      file,
      `---\ntitle: t\nsyndication:\n  devto:\n    id: 7\n    slug: "delta-en"\n---\nbody\n`,
    );
    await writebackDevtoContentHashToFile(file, "0123456789abcdef");
    const after = await readFile(file, "utf8");
    expect(after).toContain('    slug: "delta-en"\n    contentHash: "0123456789abcdef"');
    expect(after).toContain("body\n");
  });

  it("frontmatter delimiter が無いファイルでは throw", async () => {
    const file = join(postsDir, "broken.en.md");
    await writeFile(file, "no frontmatter here\n");
    await expect(writebackDevtoContentHashToFile(file, "abc1234567890def")).rejects.toThrowError(
      /frontmatter delimiter/u,
    );
  });
});

describe("extractDevtoSlugFromUrl", () => {
  it("`https://dev.to/<user>/<slug>` から末尾 slug を抜く", () => {
    expect(extractDevtoSlugFromUrl("https://dev.to/ryantsuji/foo-bar-baz")).toStrictEqual(
      "foo-bar-baz",
    );
  });

  it("trailing slash を許容", () => {
    expect(extractDevtoSlugFromUrl("https://dev.to/ryantsuji/foo-bar-baz/")).toStrictEqual(
      "foo-bar-baz",
    );
  });

  it("query / fragment は無視して slug だけ返す", () => {
    expect(extractDevtoSlugFromUrl("https://dev.to/ryantsuji/foo-bar-baz?x=1")).toStrictEqual(
      "foo-bar-baz",
    );
    expect(extractDevtoSlugFromUrl("https://dev.to/ryantsuji/foo-bar-baz#h")).toStrictEqual(
      "foo-bar-baz",
    );
  });

  it("segment 不足 (user だけ / 空) は null", () => {
    expect(extractDevtoSlugFromUrl("https://dev.to/ryantsuji")).toBeNull();
    expect(extractDevtoSlugFromUrl("https://dev.to/")).toBeNull();
  });

  it("URL parse 失敗時は null", () => {
    expect(extractDevtoSlugFromUrl("not-a-url")).toBeNull();
    expect(extractDevtoSlugFromUrl("")).toBeNull();
  });
});

describe("upsertDevtoSlug", () => {
  const fmWithDevto = [
    "title: t",
    "syndication:",
    "  devto:",
    "    id: 1",
    '    slug: "old-slug-temp-slug-999"',
    '    contentHash: "abc1234567890def"',
  ].join("\n");

  it("既存 slug 行を新しい値で上書き", () => {
    const out = upsertDevtoSlug(fmWithDevto, "new-canonical-slug");
    expect(out).toContain('    slug: "new-canonical-slug"');
    expect(out).not.toContain("old-slug-temp-slug-999");
    // 他の field は温存される
    expect(out).toContain("    id: 1");
    expect(out).toContain('    contentHash: "abc1234567890def"');
    // slug 行は重複しない
    expect(out.match(/^ {4}slug:/gmu)).toHaveLength(1);
  });

  it("devto.slug 行が無い frontmatter には throw", () => {
    const fmNoDevto = ["title: t", "syndication:", "  zenn:", '    id: "xyz"'].join("\n");
    expect(() => upsertDevtoSlug(fmNoDevto, "foo")).toThrowError(
      /syndication.devto.slug line not found/u,
    );
  });
});

describe("writebackDevtoSlugToFile", () => {
  let postsDir: string;

  beforeEach(async () => {
    postsDir = await mkdtemp(join(tmpdir(), "syndicate-slug-wb-"));
  });
  afterEach(async () => {
    await rm(postsDir, { recursive: true, force: true });
  });

  it("既存 devto.slug 行を新値で上書きし、body は触らない", async () => {
    const file = join(postsDir, "epsilon.en.md");
    await writeFile(
      file,
      `---\ntitle: t\nsyndication:\n  devto:\n    id: 5\n    slug: "old-slug-temp-slug-111"\n---\nbody content\n`,
    );
    await writebackDevtoSlugToFile(file, "new-canonical-slug");
    const after = await readFile(file, "utf8");
    expect(after).toContain('    slug: "new-canonical-slug"');
    expect(after).not.toContain("old-slug-temp-slug-111");
    expect(after).toContain("body content\n");
  });

  it("frontmatter delimiter が無いファイルでは throw", async () => {
    const file = join(postsDir, "broken.en.md");
    await writeFile(file, "no frontmatter\n");
    await expect(writebackDevtoSlugToFile(file, "foo")).rejects.toThrowError(
      /frontmatter delimiter/u,
    );
  });

  it("syndication.devto.slug 行が無いファイルでは throw", async () => {
    const file = join(postsDir, "no-slug.en.md");
    await writeFile(file, `---\ntitle: t\n---\nbody\n`);
    await expect(writebackDevtoSlugToFile(file, "foo")).rejects.toThrowError(
      /syndication.devto.slug line not found/u,
    );
  });
});
