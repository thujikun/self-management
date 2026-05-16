/**
 * tag 表示 util の網羅 test。
 *
 * syndication-only tag (`webdev` / `showdev`) は ryantsuji.dev 上では隠れる挙動を
 * 確認する。frontmatter には残るので post の data には影響しない。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business displayTags の filter 挙動 test。syndication-only tag の除外、入力順保持、空配列、全部 syndication tag の場合を網羅
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import { displayTags, SYNDICATION_ONLY_TAGS } from "./tags.js";

describe("displayTags", () => {
  it("normal tag はそのまま通す", () => {
    expect(displayTags(["mcp", "ai", "typescript"])).toStrictEqual(["mcp", "ai", "typescript"]);
  });

  it("`webdev` を除外", () => {
    expect(displayTags(["mcp", "webdev", "ai"])).toStrictEqual(["mcp", "ai"]);
  });

  it("`showdev` を除外", () => {
    expect(displayTags(["showdev", "ai"])).toStrictEqual(["ai"]);
  });

  it("複数の syndication-only tag を一度に除外", () => {
    expect(displayTags(["webdev", "ai", "showdev", "mcp"])).toStrictEqual(["ai", "mcp"]);
  });

  it("入力順を保持する", () => {
    expect(displayTags(["typescript", "ai", "mcp"])).toStrictEqual(["typescript", "ai", "mcp"]);
  });

  it("空 array は空 array", () => {
    expect(displayTags([])).toStrictEqual([]);
  });

  it("全部 syndication-only なら空 array", () => {
    expect(displayTags(["webdev", "showdev"])).toStrictEqual([]);
  });
});

describe("SYNDICATION_ONLY_TAGS", () => {
  it("`webdev` / `showdev` を含む", () => {
    expect(SYNDICATION_ONLY_TAGS.has("webdev")).toBe(true);
    expect(SYNDICATION_ONLY_TAGS.has("showdev")).toBe(true);
  });

  it("通常 tag は含まない", () => {
    expect(SYNDICATION_ONLY_TAGS.has("mcp")).toBe(false);
    expect(SYNDICATION_ONLY_TAGS.has("ai")).toBe(false);
    expect(SYNDICATION_ONLY_TAGS.has("typescript")).toBe(false);
  });
});
