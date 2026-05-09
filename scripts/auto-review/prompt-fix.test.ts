/**
 * fix prompt builder の test。snapshot で全文 drift を検知 (substring 存在は snapshot
 * が同時に保証するので個別 toContain は使わない)。
 */

import { describe, expect, it } from "vitest";

import { buildFixPrompt } from "./prompt-fix.js";

describe("buildFixPrompt", () => {
  it("生成 prompt の全文 (snapshot) — 各入力 (PR / repo / branch / reviewBody) が文面に展開される", () => {
    const out = buildFixPrompt({
      prNumber: 9,
      repo: "thujikun/self-management",
      branch: "feat/sample",
      reviewBody:
        "<!-- AUTO_REVIEW_BODY_START -->\n## Major\n- foo.ts:42 で X\n<!-- AUTO_REVIEW_BODY_END -->\n<!-- VERDICT:REQUEST_CHANGES -->",
    });
    expect(out).toMatchSnapshot();
  });
});
