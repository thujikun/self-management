/**
 * commitlint-no-skip-ci.js の predicate 単体テスト。
 *
 * 設計意図: skip-ci magic string 5 種すべてを subject / body / 引用内のどこに
 * 居ても確実に検知すること、無関係な commit は通すこと、escape 表記 (NBSP +
 * 分割) は素通しすることを inline snapshot で固定する。
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business commitlint-no-skip-ci plugin の境界網羅テスト。subject/body 検知、引用内・大小混在対応、escape 表記の素通しを inline 確認して PR #112 級の merge silently-skip 事故の再発を機械的に潰す
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import { SKIP_CI_PATTERNS, checkNoSkipCi } from "./commitlint-no-skip-ci.js";

describe("checkNoSkipCi", () => {
  it("空 / 普通の commit message は pass", () => {
    expect(checkNoSkipCi({ raw: "" })).toStrictEqual([true]);
    expect(checkNoSkipCi({ raw: "feat: hello world" })).toStrictEqual([true]);
    expect(checkNoSkipCi({ raw: undefined })).toStrictEqual([true]);
    expect(checkNoSkipCi({ raw: null })).toStrictEqual([true]);
  });

  it("subject に [skip ci] 含むと fail", () => {
    const [pass, msg] = checkNoSkipCi({ raw: "fix: hot patch [skip ci]" });
    expect(pass).toBe(false);
    expect(msg).toContain("[skip ci]");
    expect(msg).toContain("silently skips");
  });

  it("body 中の backtick 引用内でも fail (PR #112 の事故 reproducer)", () => {
    const raw = [
      "fix: workflow comments",
      "",
      "syndicate-posts の `[skip ci]` writeback commit が並行に着地したケースを吸収",
    ].join("\n");
    const [pass, msg] = checkNoSkipCi({ raw });
    expect(pass).toBe(false);
    expect(msg).toMatch(/skip-ci magic string/);
  });

  it("5 種 magic string すべて検知 ([skip ci] / [ci skip] / [no ci] / [skip actions] / [actions skip])", () => {
    const tokens = ["[skip ci]", "[ci skip]", "[no ci]", "[skip actions]", "[actions skip]"];
    for (const t of tokens) {
      const [pass] = checkNoSkipCi({ raw: `body mentioning ${t}` });
      expect(pass, `${t} should be detected`).toBe(false);
    }
  });

  it("大小混在 ([Skip CI] / [SKIP ci]) も検知 (case-insensitive)", () => {
    expect(checkNoSkipCi({ raw: "[Skip CI]" })[0]).toBe(false);
    expect(checkNoSkipCi({ raw: "[SKIP ci]" })[0]).toBe(false);
    expect(checkNoSkipCi({ raw: "[Ci Skip]" })[0]).toBe(false);
  });

  it("non-breaking space で escape した [skip\\u00A0ci] は通る", () => {
    const raw = "docs: explain the [skip ci] magic in prose";
    expect(checkNoSkipCi({ raw })).toStrictEqual([true]);
  });

  it("split 表記 ([skip + space + ci]) は通る (= 物理的に 1 文字列ではない)", () => {
    const raw = 'docs: see "[skip" + " ci]" form for safe quoting';
    // 連続 1 文字列 "[skip ci]" は出現しないので pass
    expect(checkNoSkipCi({ raw })).toStrictEqual([true]);
  });

  it("似ているが別物 ([skip-ci] / [skipci] / [skip  ci]) は通る (正確な literal のみ拾う)", () => {
    expect(checkNoSkipCi({ raw: "[skip-ci]" })).toStrictEqual([true]);
    expect(checkNoSkipCi({ raw: "[skipci]" })).toStrictEqual([true]);
    // 二重 space は GitHub の matcher が拾わないので通す
    expect(checkNoSkipCi({ raw: "[skip  ci]" })).toStrictEqual([true]);
  });

  it("error message に escape 例 ([skip\\u00A0ci] / [skip + ci]) を提示する", () => {
    const [, msg] = checkNoSkipCi({ raw: "fix: oops [no ci]" });
    expect(msg).toContain("[skip\\u00A0ci]");
    expect(msg).toContain('"[skip" + " ci]"');
  });
});

describe("SKIP_CI_PATTERNS", () => {
  it("公式 docs の 5 種 magic string をすべて含む", () => {
    expect(SKIP_CI_PATTERNS).toHaveLength(5);
    const sources = SKIP_CI_PATTERNS.map((re) => re.source);
    expect(sources).toStrictEqual([
      "\\[skip ci\\]",
      "\\[ci skip\\]",
      "\\[no ci\\]",
      "\\[skip actions\\]",
      "\\[actions skip\\]",
    ]);
  });

  it("immutable (frozen) — 実装側で誤って push しても TypeError", () => {
    expect(Object.isFrozen(SKIP_CI_PATTERNS)).toBe(true);
  });
});
