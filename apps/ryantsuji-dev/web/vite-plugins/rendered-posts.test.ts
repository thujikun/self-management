/**
 * rendered-posts vite plugin の挙動 test。
 *
 * 対象:
 * - `renderAllPosts(postsDir)`: .md 以外 skip、空 dir、複数 file の sort 安定性、
 *   filename → RenderedDoc map の構造
 * - `renderedPostsPlugin(...)`: `resolveId` / `load` の virtual-id 経路、
 *   `configureServer` の watcher hook (.md change で trigger、.md 以外で no-op)
 *
 * markdown render は @self/content の renderMarkdown を実行するため、shiki の cold
 * start (≈ 1s) を含む。testTimeout は root config の 30s で充分カバー。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business build-time markdown pre-render の critical path を tmpdir fixture で実行し、filename 規約 / 非 .md skip / watcher hook を固定。markdown 1 件でも render に失敗したら blog 全体が壊れる構造なので unit test で regression を機械防止する
 * @graph-connects none
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderAllPosts, renderedPostsPlugin } from "./rendered-posts.js";

const MINIMAL_FRONTMATTER = `---
title: "Hi"
publishedAt: "2026-01-01"
---
`;

describe("renderAllPosts", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "rendered-posts-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it(".md 以外は skip し、md のみ filename key で RenderedDoc を返す", async () => {
    await writeFile(join(dir, ".gitkeep"), "");
    await writeFile(join(dir, "notes.txt"), "not markdown");
    await writeFile(join(dir, "hello.en.md"), `${MINIMAL_FRONTMATTER}body text`);

    const out = await renderAllPosts(dir);

    expect(Object.keys(out)).toStrictEqual(["hello.en.md"]);
    expect(out["hello.en.md"]?.frontmatter.title).toStrictEqual("Hi");
    expect(out["hello.en.md"]?.frontmatter.publishedAt).toStrictEqual("2026-01-01");
    expect(out["hello.en.md"]?.html).toContain("body text");
  });

  it("空 dir では空 object を返す (web loader が draft-only と区別できる shape)", async () => {
    const out = await renderAllPosts(dir);
    expect(out).toStrictEqual({});
  });

  it("複数 .md は filename の lexicographic sort 順に key が並ぶ (FS 順依存しない)", async () => {
    // 意図的に逆順で write して、readdir の OS 依存順序を再現させる。sort 済みなら
    // alphabetical で必ず ["a.en.md", "b.en.md", "c.en.md"] になる。
    await writeFile(join(dir, "c.en.md"), `${MINIMAL_FRONTMATTER}c`);
    await writeFile(join(dir, "a.en.md"), `${MINIMAL_FRONTMATTER}a`);
    await writeFile(join(dir, "b.en.md"), `${MINIMAL_FRONTMATTER}b`);

    const out = await renderAllPosts(dir);

    expect(Object.keys(out)).toStrictEqual(["a.en.md", "b.en.md", "c.en.md"]);
  });
});

describe("renderedPostsPlugin", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "rendered-posts-plugin-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("name は安定 identifier (vite log / debugger で grep されるため固定)", () => {
    const plugin = renderedPostsPlugin(dir);
    expect(plugin.name).toStrictEqual("rendered-posts");
  });

  it("resolveId は virtual id だけ受けて他は null を返す", () => {
    const plugin = renderedPostsPlugin(dir);
    const resolveId = plugin.resolveId as (id: string) => string | null;

    expect(resolveId.call({}, "virtual:rendered-posts")).toStrictEqual("\0virtual:rendered-posts");
    expect(resolveId.call({}, "some-other-id")).toStrictEqual(null);
  });

  it("load は resolved virtual id でだけ JS module 文字列を返し、他は null", async () => {
    await writeFile(join(dir, "hello.en.md"), `${MINIMAL_FRONTMATTER}body`);
    const plugin = renderedPostsPlugin(dir);
    const load = plugin.load as (id: string) => Promise<string | null>;

    const out = await load.call({}, "\0virtual:rendered-posts");
    const miss = await load.call({}, "not-the-virtual-id");

    expect(miss).toStrictEqual(null);
    expect(out).toContain("export const renderedPosts =");
    expect(out).toContain("hello.en.md");
  });

  it("configureServer は postsDir を watcher.add し、.md change で invalidate + full-reload を発火", () => {
    const plugin = renderedPostsPlugin(dir);
    const configureServer = plugin.configureServer as (server: unknown) => void;

    const invalidateModule = vi.fn();
    const fakeModule = { id: "\0virtual:rendered-posts" };
    const watcherListeners = new Map<string, (p: string) => void>();
    const watcherAdd = vi.fn();
    const wsSend = vi.fn();
    const fakeServer = {
      moduleGraph: {
        getModuleById: vi.fn().mockReturnValue(fakeModule),
        invalidateModule,
      },
      watcher: {
        add: watcherAdd,
        on: (event: string, listener: (p: string) => void) => {
          watcherListeners.set(event, listener);
        },
      },
      ws: { send: wsSend },
    };

    configureServer(fakeServer);

    expect(watcherAdd).toHaveBeenCalledWith(dir);
    expect([...watcherListeners.keys()].sort()).toStrictEqual(["add", "change", "unlink"]);

    // .md change → invalidate + full-reload
    watcherListeners.get("change")?.(join(dir, "a.en.md"));
    expect(invalidateModule).toHaveBeenCalledWith(fakeModule);
    expect(wsSend).toHaveBeenCalledWith({ type: "full-reload" });

    // .md add も同じ trigger 経路
    invalidateModule.mockClear();
    wsSend.mockClear();
    watcherListeners.get("add")?.(join(dir, "b.en.md"));
    expect(invalidateModule).toHaveBeenCalledWith(fakeModule);
    expect(wsSend).toHaveBeenCalledWith({ type: "full-reload" });

    // .md unlink も同じ trigger 経路
    invalidateModule.mockClear();
    wsSend.mockClear();
    watcherListeners.get("unlink")?.(join(dir, "c.en.md"));
    expect(invalidateModule).toHaveBeenCalledWith(fakeModule);
    expect(wsSend).toHaveBeenCalledWith({ type: "full-reload" });

    // 非 .md / postsDir 外は no-op (フィルタ条件の境界)
    invalidateModule.mockClear();
    wsSend.mockClear();
    watcherListeners.get("change")?.(join(dir, "notes.txt"));
    watcherListeners.get("change")?.("/somewhere/else/a.md");
    expect(invalidateModule).not.toHaveBeenCalled();
    expect(wsSend).not.toHaveBeenCalled();
  });

  it("configureServer の trigger は moduleGraph に entry が無いときも full-reload は発火 (invalidate は skip)", () => {
    const plugin = renderedPostsPlugin(dir);
    const configureServer = plugin.configureServer as (server: unknown) => void;

    const invalidateModule = vi.fn();
    const wsSend = vi.fn();
    const watcherListeners = new Map<string, (p: string) => void>();
    const fakeServer = {
      moduleGraph: {
        getModuleById: vi.fn().mockReturnValue(undefined),
        invalidateModule,
      },
      watcher: {
        add: vi.fn(),
        on: (event: string, listener: (p: string) => void) => {
          watcherListeners.set(event, listener);
        },
      },
      ws: { send: wsSend },
    };

    configureServer(fakeServer);
    watcherListeners.get("change")?.(join(dir, "a.en.md"));

    expect(invalidateModule).not.toHaveBeenCalled();
    expect(wsSend).toHaveBeenCalledWith({ type: "full-reload" });
  });
});
