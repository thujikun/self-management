/**
 * conflict-fix prompt builder の test。snapshot で全文 drift を検知。
 * mergeAttempted の true / false で文面が分岐するので両方踏む。
 */

import { describe, expect, it } from "vitest";

import { buildConflictFixPrompt } from "./prompt-conflict-fix.js";

describe("buildConflictFixPrompt", () => {
  it("mergeAttempted=true: worktree 作成時に merge 試行済 → MERGE_HEAD あり想定の文面", () => {
    const out = buildConflictFixPrompt({
      prNumber: 33,
      repo: "thujikun/self-management",
      branch: "feat/sample",
      mergeAttempted: true,
    });
    expect(out).toMatchSnapshot();
  });

  it("mergeAttempted=false: poll〜worktree 作成の間に GH 側で conflict 解消されていた case", () => {
    const out = buildConflictFixPrompt({
      prNumber: 33,
      repo: "thujikun/self-management",
      branch: "feat/sample",
      mergeAttempted: false,
    });
    expect(out).toMatchSnapshot();
  });
});
