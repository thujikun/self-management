/**
 * claude.ts の pure parser / builder の test。spawn 部分は mock せず別建ての integration 領域。
 */

import { describe, expect, it } from "vitest";

import { buildBotCommentBody, parseReviewOutput } from "./claude.js";

describe("parseReviewOutput", () => {
  it("REQUEST_CHANGES の通常レビューを抽出", () => {
    const stdout = [
      "preface ignored by parser",
      "<!-- AUTO_REVIEW_BODY_START -->",
      "## Major",
      "- foo.ts:42 で X",
      "<!-- AUTO_REVIEW_BODY_END -->",
      "<!-- VERDICT:REQUEST_CHANGES -->",
    ].join("\n");
    expect(parseReviewOutput(stdout)).toStrictEqual({
      body: "## Major\n- foo.ts:42 で X",
      verdict: "REQUEST_CHANGES",
      fixFailedReason: null,
    });
  });

  it("APPROVE の verdict marker のみで body は parse 成功", () => {
    const stdout = [
      "<!-- AUTO_REVIEW_BODY_START -->",
      "指摘なし、6 gate 全 green",
      "<!-- AUTO_REVIEW_BODY_END -->",
      "<!-- VERDICT:APPROVE -->",
    ].join("\n");
    expect(parseReviewOutput(stdout)).toStrictEqual({
      body: "指摘なし、6 gate 全 green",
      verdict: "APPROVE",
      fixFailedReason: null,
    });
  });

  it("NO_OP は verdict のみ、body は null", () => {
    expect(parseReviewOutput("<!-- VERDICT:NO_OP -->\n")).toStrictEqual({
      body: null,
      verdict: "NO_OP",
      fixFailedReason: null,
    });
  });

  it("body marker 不一致 (END だけ無い) は body null", () => {
    const stdout = "<!-- AUTO_REVIEW_BODY_START -->\nrest\n<!-- VERDICT:REQUEST_CHANGES -->";
    expect(parseReviewOutput(stdout)).toStrictEqual({
      body: null,
      verdict: "REQUEST_CHANGES",
      fixFailedReason: null,
    });
  });

  it("FIX_FAILED 理由を抽出", () => {
    const stdout = "<!-- FIX_FAILED:conflict 解消できず -->\n";
    expect(parseReviewOutput(stdout)).toStrictEqual({
      body: null,
      verdict: null,
      fixFailedReason: "conflict 解消できず",
    });
  });

  it("verdict 順位: NO_OP が他より優先 (重複時のフォールバック)", () => {
    // ありえない並びだが、NO_OP が混入したら NO_OP に倒す
    const stdout =
      "<!-- VERDICT:NO_OP -->\n<!-- AUTO_REVIEW_BODY_START -->\nx\n<!-- AUTO_REVIEW_BODY_END -->\n<!-- VERDICT:REQUEST_CHANGES -->";
    expect(parseReviewOutput(stdout).verdict).toStrictEqual("NO_OP");
  });
});

describe("buildBotCommentBody", () => {
  it("body trim + marker で囲む + verdict を末尾に", () => {
    expect(buildBotCommentBody("  本文\n  ", "APPROVE")).toStrictEqual(
      [
        "<!-- AUTO_REVIEW_BODY_START -->",
        "本文",
        "<!-- AUTO_REVIEW_BODY_END -->",
        "<!-- VERDICT:APPROVE -->",
      ].join("\n"),
    );
  });
});
