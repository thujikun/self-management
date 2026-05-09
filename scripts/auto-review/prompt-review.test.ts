/**
 * review prompt builder の test。
 *
 * marker 定数は `toStrictEqual` で公開契約として固定。prompt 全体は出力 snapshot
 * (`toMatchSnapshot`) で文面 drift を検知する (snapshot は __snapshots__ に生成、
 * 実意図変更時は `vitest -u` で更新)。
 */

import { describe, expect, it } from "vitest";

import {
  BODY_END,
  BODY_START,
  buildReviewPrompt,
  VERDICT_APPROVE,
  VERDICT_NO_OP,
  VERDICT_REQUEST_CHANGES,
} from "./prompt-review.js";

describe("marker 定数", () => {
  it("公開契約として固定", () => {
    expect({
      BODY_START,
      BODY_END,
      VERDICT_REQUEST_CHANGES,
      VERDICT_APPROVE,
      VERDICT_NO_OP,
    }).toStrictEqual({
      BODY_START: "<!-- AUTO_REVIEW_BODY_START -->",
      BODY_END: "<!-- AUTO_REVIEW_BODY_END -->",
      VERDICT_REQUEST_CHANGES: "<!-- VERDICT:REQUEST_CHANGES -->",
      VERDICT_APPROVE: "<!-- VERDICT:APPROVE -->",
      VERDICT_NO_OP: "<!-- VERDICT:NO_OP -->",
    });
  });
});

describe("buildReviewPrompt", () => {
  it("最小入力で生成される prompt の全文 (snapshot)", () => {
    expect(buildReviewPrompt({ prNumber: 7, repo: "thujikun/self-management" })).toMatchSnapshot();
  });

  it("lastReviewBodyHash 付きで NO_OP 比較ヒントが本文に追加される (差分は hash ヒント行のみ)", () => {
    const hash = "a".repeat(64);
    const withHash = buildReviewPrompt({
      prNumber: 7,
      repo: "thujikun/self-management",
      lastReviewBodyHash: hash,
    });
    const withoutHash = buildReviewPrompt({ prNumber: 7, repo: "thujikun/self-management" });
    // hash 付き版から hint 行を削った結果が hint 無し版に一致する
    const stripped = withHash.replace(`\n  (参考: 前回の正規化 body hash = ${hash})`, "");
    expect(stripped).toStrictEqual(withoutHash);
  });
});
