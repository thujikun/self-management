/*
 * check-posts-frontmatter.ts pure logic の test。collectFrontmatterViolations の
 * pass / 違反収集と、formatParseError の Zod issues / Error / 非 Error 整形を網羅する。
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business check-posts-frontmatter pure 層の単体テスト。parse 述語注入で violation 収集の分岐 (全 pass / 一部 throw / 複数 throw) と formatParseError の Zod issues / Error message / String fallback を固定する
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import { collectFrontmatterViolations, formatParseError } from "./check-posts-frontmatter.js";

describe("collectFrontmatterViolations", () => {
  it("全 post が parse 通過なら violation なし", () => {
    const out = collectFrontmatterViolations(
      [
        { file: "a.en.md", data: { ok: true } },
        { file: "b.ja.md", data: { ok: true } },
      ],
      () => undefined,
    );
    expect(out).toStrictEqual([]);
  });

  it("throw した post を file:message で収集 (他は通過)", () => {
    const out = collectFrontmatterViolations(
      [
        { file: "good.en.md", data: { id: 1 } },
        { file: "bad.en.md", data: { id: "TBD" } },
      ],
      (data) => {
        if ((data as { id: unknown }).id === "TBD") {
          throw new Error("expected number, received string");
        }
      },
    );
    expect(out).toStrictEqual([{ file: "bad.en.md", message: "expected number, received string" }]);
  });

  it("複数 post が throw したら全件収集 (順序保持)", () => {
    const out = collectFrontmatterViolations(
      [
        { file: "x.en.md", data: 1 },
        { file: "y.ja.md", data: 2 },
      ],
      () => {
        throw new Error("boom");
      },
    );
    expect(out.map((v) => v.file)).toStrictEqual(["x.en.md", "y.ja.md"]);
  });

  it("空入力は空配列", () => {
    expect(collectFrontmatterViolations([], () => undefined)).toStrictEqual([]);
  });
});

describe("formatParseError", () => {
  it("Zod 風 issues[] を `path: message` の `;` 連結に整形", () => {
    const err = {
      issues: [
        { path: ["syndication", "devto", "id"], message: "expected number, received string" },
        { path: ["syndication", "devto", "slug"], message: "expected string, received undefined" },
      ],
    };
    expect(formatParseError(err)).toBe(
      "syndication.devto.id: expected number, received string; " +
        "syndication.devto.slug: expected string, received undefined",
    );
  });

  it("path 空の issue は (root) と表示", () => {
    expect(formatParseError({ issues: [{ path: [], message: "invalid" }] })).toBe(
      "(root): invalid",
    );
  });

  it("issues 無しの Error は message を使う", () => {
    expect(formatParseError(new Error("plain failure"))).toBe("plain failure");
  });

  it("Error でも issues でもない値は String 化", () => {
    expect(formatParseError("just a string")).toBe("just a string");
  });
});
