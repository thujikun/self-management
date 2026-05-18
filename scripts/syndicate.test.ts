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
  buildZennResolver,
  emitDevto,
  emitZenn,
  generateZennId,
  insertSyndicationBlock,
  parseFileName,
  readAllPosts,
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

  it("includeDrafts: true で draft も含めて返す", async () => {
    await writeFile(join(dir, "alpha.ja.md"), baseFm("draft: true\n"));
    await writeFile(join(dir, "beta.ja.md"), baseFm());
    const posts = await readAllPosts(dir, { includeDrafts: true });
    expect(posts.map((p) => p.slug).sort()).toStrictEqual(["alpha", "beta"]);
  });

  it("`_` prefix slug (test fixture) は includeDrafts でも syndication 対象から除外", async () => {
    await writeFile(join(dir, "_fixture.ja.md"), baseFm("draft: true\n"));
    await writeFile(join(dir, "_minimal.en.md"), baseFm());
    await writeFile(join(dir, "real.ja.md"), baseFm());
    const posts = await readAllPosts(dir, { includeDrafts: true });
    expect(posts.map((p) => p.slug).sort()).toStrictEqual(["real"]);
  });

  it("excludeFromSyndication: true の post は syndication 対象から除外", async () => {
    await writeFile(join(dir, "internal.ja.md"), baseFm("excludeFromSyndication: true\n"));
    await writeFile(join(dir, "public.ja.md"), baseFm());
    const posts = await readAllPosts(dir);
    expect(posts.map((p) => p.slug).sort()).toStrictEqual(["public"]);
  });

  it("includeExcluded: true で excludeFromSyndication post も返す (generate-covers 等の non-syndicate 経路用)", async () => {
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
    expect(warnSpy).toHaveBeenCalledWith("  [skip] alpha.en.md: no syndication.devto (dry-run)");
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

    // writeback で devto.{id, slug} が src file に書かれる
    const after = await readFile(srcFile, "utf8");
    expect(after).toMatchInlineSnapshot(`
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
    // 出力 JSON は新規 id で書かれる
    const written = JSON.parse(await readFile(resolve(outDir, "alpha.json"), "utf8")) as {
      id: number;
    };
    expect(written.id).toStrictEqual(12345);
    // POST 直後の body と PUT body が同一なので二度叩きしない (Major #4)
    expect(createDevtoArticleMock).toHaveBeenCalledTimes(1);
    expect(publishToDevtoMock).not.toHaveBeenCalled();
  });

  it("devto 既存の .en post を publish: createDevtoArticle は呼ばず PUT で update", async () => {
    publishToDevtoMock.mockResolvedValueOnce({
      url: "https://dev.to/ryantsuji/beta",
      editedAt: "2026-05-17T00:00:00Z",
    });
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
  });
});
