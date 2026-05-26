/*
 * `posts-files.ts` の lightweight 列挙層の test。`@self/content` を経由しないことを
 * 機械的に保証し、`listPostFiles` が draft 含む全 (slug, lang) を返すことを tmpdir
 * fixture で固定する。
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business posts-files の単体テスト。parseFileName regex / listPostFiles が draft 含め全 post を列挙すること / filename 規約外 ignore を tmpdir fixture で固定する
 * @graph-connects none
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listPostFiles, parseFileName } from "./posts-files.js";

describe("parseFileName", () => {
  it("kebab-case slug + lang を取り出す", () => {
    expect(parseFileName("foo-bar.ja.md")).toStrictEqual({ slug: "foo-bar", lang: "ja" });
    expect(parseFileName("foo-bar.en.md")).toStrictEqual({ slug: "foo-bar", lang: "en" });
  });

  it("digit prefix は許容", () => {
    expect(parseFileName("17-mcp-servers.en.md")).toStrictEqual({
      slug: "17-mcp-servers",
      lang: "en",
    });
  });

  it("underscore prefix は許容 (fixture / draft 規約)", () => {
    expect(parseFileName("_minimal-fixture.en.md")).toStrictEqual({
      slug: "_minimal-fixture",
      lang: "en",
    });
  });

  it("uppercase 混じり filename は reject (lowercase SoT を強制)", () => {
    expect(parseFileName("Foo.en.md")).toStrictEqual(null);
  });

  it("lang が ja/en 以外は reject", () => {
    expect(parseFileName("foo.fr.md")).toStrictEqual(null);
  });

  it(".md 以外の suffix は reject", () => {
    expect(parseFileName("foo.en.txt")).toStrictEqual(null);
  });

  it("lang segment 無しは reject", () => {
    expect(parseFileName("foo.md")).toStrictEqual(null);
  });
});

describe("listPostFiles", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(resolve(tmpdir(), "posts-files-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("全 valid filename を列挙する (順序は filesystem 依存なので set で評価)", async () => {
    await writeFile(resolve(dir, "alpha.en.md"), '---\ntitle: "x"\n---\n');
    await writeFile(resolve(dir, "alpha.ja.md"), '---\ntitle: "y"\n---\n');
    await writeFile(resolve(dir, "beta.en.md"), '---\ntitle: "z"\n---\n');
    const out = await listPostFiles(dir);
    const sorted = [...out].sort((a, b) =>
      `${a.slug}.${a.lang}`.localeCompare(`${b.slug}.${b.lang}`),
    );
    expect(sorted).toStrictEqual([
      { slug: "alpha", lang: "en" },
      { slug: "alpha", lang: "ja" },
      { slug: "beta", lang: "en" },
    ]);
  });

  it("`draft: true` の post も列挙する (cover は draft 段階から必要 — flip 時 404 防止)", async () => {
    await writeFile(resolve(dir, "public.en.md"), '---\ntitle: "x"\n---\n');
    await writeFile(resolve(dir, "wip.en.md"), '---\ntitle: "y"\ndraft: true\n---\n');
    const out = await listPostFiles(dir);
    const sorted = [...out].sort((a, b) => a.slug.localeCompare(b.slug));
    expect(sorted).toStrictEqual([
      { slug: "public", lang: "en" },
      { slug: "wip", lang: "en" },
    ]);
  });

  it("filename 規約外の file は無視する (.txt / mixed case / lang 不一致)", async () => {
    await writeFile(resolve(dir, "alpha.en.md"), '---\ntitle: "x"\n---\n');
    await writeFile(resolve(dir, "README.md"), "ignored\n");
    await writeFile(resolve(dir, "alpha.fr.md"), '---\ntitle: "fr"\n---\n');
    await writeFile(resolve(dir, "alpha.en.txt"), "noop\n");
    const out = await listPostFiles(dir);
    expect(out).toStrictEqual([{ slug: "alpha", lang: "en" }]);
  });

  it("`_` 始まり fixture も列挙される (skip 判定は consumer = findMissingCovers 側)", async () => {
    // posts-files は「published か」だけを判定し、`_` 規約による skip は呼び出し側の
    // `shouldHaveCover` に委ねる責務分離。本 test はその不変条件を固定する。
    await writeFile(resolve(dir, "_fixture.en.md"), '---\ntitle: "x"\n---\n');
    await writeFile(resolve(dir, "real.en.md"), '---\ntitle: "y"\n---\n');
    const out = await listPostFiles(dir);
    const sorted = [...out].sort((a, b) => a.slug.localeCompare(b.slug));
    expect(sorted).toStrictEqual([
      { slug: "_fixture", lang: "en" },
      { slug: "real", lang: "en" },
    ]);
  });

  it("空 dir は空配列を返す", async () => {
    const out = await listPostFiles(dir);
    expect(out).toStrictEqual([]);
  });
});
