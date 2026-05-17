/**
 * conflict-fix prompt builder の test。snapshot で全文 drift を検知。
 * conflictsRemaining の true / false で文面が分岐するので両方踏む。
 */

import { describe, expect, it } from "vitest";

import { buildConflictFixPrompt } from "./prompt-conflict-fix.js";

describe("buildConflictFixPrompt", () => {
  it("conflictsRemaining=true: worktree の auto-merge が失敗し marker 残置 → AI が解消する文面", () => {
    const out = buildConflictFixPrompt({
      prNumber: 33,
      repo: "thujikun/self-management",
      branch: "feat/sample",
      conflictsRemaining: true,
    });
    expect(out).toMatchSnapshot();
  });

  it("conflictsRemaining=false: poll〜worktree 作成の間に GH 側で conflict 解消されていた → push のみ", () => {
    const out = buildConflictFixPrompt({
      prNumber: 33,
      repo: "thujikun/self-management",
      branch: "feat/sample",
      conflictsRemaining: false,
    });
    expect(out).toMatchSnapshot();
  });
});
