/**
 * `renderMarkdown` の singleton highlighter cache が並行初回呼び出しに対して
 * race を起こさないことの regression test。
 *
 * `_highlighterPromise` は値ではなく **promise** を cache する設計で、worker
 * isolate が cold 状態で `renderMarkdown` を 2 件並行に受けても
 * `createHighlighterCore` (= 17 grammars + JS regex engine の compile) は
 * 1 回のみ走ることを保証する。値 cache だった旧実装ではここで 2 回走り、
 * 片方の compile 結果が捨てられていた。
 *
 * モジュール状態は test file 毎に isolate される (vitest forks pool) ため、
 * 本ファイルは `render.test.ts` の prewarm に影響されず、cold path を計測できる。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business shiki highlighter の lazy singleton が並行初回呼び出しで二重 init を起こさないことを保証する regression。`createHighlighterCore` を spy し、Promise.all([renderMarkdown, renderMarkdown]) で call count が 1 であることを assert する
 * @graph-connects none
 */

import { describe, expect, it, vi } from "vitest";

// shiki/core を wrap して createHighlighterCore を spy 化する。実体は actual に
// 委譲するので grammar compile は本物が走り、E2E の振る舞いは render.test.ts と
// 同等。ここでは「何回呼ばれたか」のみを観測する。
vi.mock("shiki/core", async () => {
  const actual = await vi.importActual<typeof import("shiki/core")>("shiki/core");
  return {
    ...actual,
    createHighlighterCore: vi.fn(actual.createHighlighterCore),
  };
});

import { createHighlighterCore } from "shiki/core";

import { renderMarkdown } from "./render.js";

describe("renderMarkdown highlighter singleton race", () => {
  it("並行初回呼び出しでも createHighlighterCore は 1 回のみ呼ばれる", async () => {
    const spy = vi.mocked(createHighlighterCore);
    const source = ["---", 'title: "x"', 'publishedAt: "2026-05-08"', "---", "", "body"].join("\n");

    const [a, b] = await Promise.all([renderMarkdown(source), renderMarkdown(source)]);

    expect(spy).toHaveBeenCalledTimes(1);
    // 両方 valid な RenderedDoc を返すこと (片方が捨てられていないことの確認)
    expect(a.html).toMatch(/<p>body<\/p>/);
    expect(b.html).toMatch(/<p>body<\/p>/);
  }, 60_000);

  it("解決後の追加呼び出しでも cache が共有され createHighlighterCore は増えない", async () => {
    const spy = vi.mocked(createHighlighterCore);
    const before = spy.mock.calls.length;
    const source = ["---", 'title: "x"', 'publishedAt: "2026-05-08"', "---", "", "more"].join("\n");

    await renderMarkdown(source);
    await renderMarkdown(source);

    expect(spy.mock.calls.length).toBe(before);
  });
});
