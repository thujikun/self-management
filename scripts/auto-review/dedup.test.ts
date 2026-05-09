/**
 * レビュー本文正規化 + hash の境界 test。
 */

import { describe, expect, it } from "vitest";

import { hashBody, isSameReview, normalizeBody } from "./dedup.js";

describe("normalizeBody", () => {
  it("VERDICT / BODY START / END マーカーを除去", () => {
    const input =
      "<!-- AUTO_REVIEW_BODY_START -->\n本文\n<!-- AUTO_REVIEW_BODY_END -->\n<!-- VERDICT:REQUEST_CHANGES -->";
    expect(normalizeBody(input)).toStrictEqual("本文");
  });

  it("イテレーション表記 (英日混合) を除去", () => {
    const inputs = [
      "Round 3 だが本文は同じ",
      "3 回目のレビュー",
      "Iteration 5 details",
      "第 2 回 詳細",
    ];
    expect(inputs.map(normalizeBody)).toStrictEqual([
      "だが本文は同じ",
      "のレビュー",
      "details",
      "詳細",
    ]);
  });

  it("6 桁以上の数字 ID を `<ID>` に統一", () => {
    expect(normalizeBody("PR #3169169163 を参照")).toStrictEqual("PR #<ID> を参照");
  });

  it("行番号 (L854) や短い数字は保持", () => {
    expect([normalizeBody("file.ts:42 で"), normalizeBody("L854 を確認")]).toStrictEqual([
      "file.ts:42 で",
      "L854 を確認",
    ]);
  });

  it("ISO8601 timestamp を `<TS>` に統一", () => {
    expect([
      normalizeBody("at 2026-05-09T00:00:00Z で起きた"),
      normalizeBody("2026-05-09T00:00:00.123Z は ms 付き"),
    ]).toStrictEqual(["at <TS> で起きた", "<TS> は ms 付き"]);
  });

  it("連続空白を 1 つに圧縮 + 前後 trim", () => {
    expect(normalizeBody("  hello   world  \n\n  next  ")).toStrictEqual("hello world next");
  });
});

describe("hashBody", () => {
  it("空文字 body の hash も 64 字 hex で決定的", () => {
    expect(hashBody("")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashBody("")).toStrictEqual(hashBody(""));
  });

  it("正規化後同じなら hash も同じ (iteration 表記の差を吸収)", () => {
    expect(hashBody("Round 3 same body")).toStrictEqual(hashBody("Round 7 same body"));
  });

  it("正規化後異なれば hash も異なる", () => {
    expect(hashBody("body A")).not.toStrictEqual(hashBody("body B"));
  });
});

describe("isSameReview", () => {
  it("verdict marker / iteration 表記が違っても本文が同じなら true、違うなら false", () => {
    const a =
      "<!-- AUTO_REVIEW_BODY_START -->\nRound 1: 弱い matcher が 22 件\n<!-- AUTO_REVIEW_BODY_END -->\n<!-- VERDICT:REQUEST_CHANGES -->";
    const b =
      "<!-- AUTO_REVIEW_BODY_START -->\nRound 5: 弱い matcher が 22 件\n<!-- AUTO_REVIEW_BODY_END -->\n<!-- VERDICT:REQUEST_CHANGES -->";
    const c = "draft 漏出";
    const d = "format check fail";
    // 同一判定 + 別判定をまとめて表として固定
    expect([isSameReview(a, b), isSameReview(c, d)]).toStrictEqual([true, false]);
  });
});
