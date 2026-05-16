/**
 * `validateCommentBody` / `normalizeTimestamp` の純関数 test。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business engagement の入力 validation / 正規化の境界条件を inline で網羅。empty / 上限 / Date / string / null を全部踏む
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import {
  COMMENT_BODY_MAX,
  normalizeTimestamp,
  validateCommentBody,
  validateReplyParent,
} from "./engagement-validate.js";

describe("validateCommentBody", () => {
  it("trim 済の通常本文を返す", () => {
    expect(validateCommentBody("  hello  ")).toStrictEqual("hello");
  });

  it("空文字 → throw (INVALID_COMMENT_BODY: empty)", () => {
    expect(() => validateCommentBody("")).toThrow(/INVALID_COMMENT_BODY: empty/);
  });

  it("空白のみ → throw (trim 後 empty)", () => {
    expect(() => validateCommentBody("   \n\t  ")).toThrow(/INVALID_COMMENT_BODY: empty/);
  });

  it("上限ちょうど (4000) は通す", () => {
    const body = "a".repeat(COMMENT_BODY_MAX);
    expect(validateCommentBody(body)).toStrictEqual(body);
  });

  it("上限 +1 → throw (INVALID_COMMENT_BODY: max ...)", () => {
    const body = "a".repeat(COMMENT_BODY_MAX + 1);
    expect(() => validateCommentBody(body)).toThrow(/max 4000/);
  });
});

describe("normalizeTimestamp", () => {
  it("Date → ISO 文字列", () => {
    const d = new Date("2026-05-10T01:02:03.000Z");
    expect(normalizeTimestamp(d)).toStrictEqual("2026-05-10T01:02:03.000Z");
  });

  it("string → そのまま", () => {
    expect(normalizeTimestamp("2026-05-10T00:00:00Z")).toStrictEqual("2026-05-10T00:00:00Z");
  });

  it("null → 空文字", () => {
    expect(normalizeTimestamp(null)).toStrictEqual("");
  });

  it("undefined → 空文字", () => {
    expect(normalizeTimestamp(undefined)).toStrictEqual("");
  });
});

describe("validateReplyParent", () => {
  it("parent null (FK 解決不能) → INVALID_PARENT_COMMENT: not found", () => {
    expect(() => validateReplyParent({ parent: null, expectedSlug: "a" })).toThrow(
      /INVALID_PARENT_COMMENT: not found/,
    );
  });

  it("post slug mismatch (post 跨ぎ reply) → INVALID_PARENT_COMMENT: post mismatch", () => {
    expect(() =>
      validateReplyParent({
        parent: { postSlug: "other-post", parentCommentId: null },
        expectedSlug: "this-post",
      }),
    ).toThrow(/INVALID_PARENT_COMMENT: post mismatch/);
  });

  it("親が既に reply (parentCommentId 非 null) → REPLY_DEPTH_EXCEEDED", () => {
    expect(() =>
      validateReplyParent({
        parent: { postSlug: "p", parentCommentId: "some-parent-uuid" },
        expectedSlug: "p",
      }),
    ).toThrow(/REPLY_DEPTH_EXCEEDED/);
  });

  it("親が top-level (parentCommentId=null) + slug 一致 → 通過 (void)", () => {
    expect(
      validateReplyParent({
        parent: { postSlug: "p", parentCommentId: null },
        expectedSlug: "p",
      }),
    ).toStrictEqual(undefined);
  });
});
