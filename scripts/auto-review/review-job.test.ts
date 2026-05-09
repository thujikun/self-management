/**
 * review-job.ts の path 別 test。副作用は dep injection で fake、state 遷移を assertion する。
 *
 * 検証する分岐:
 *   - timeout → sha bookmark + iteration++ (anti-loop)
 *   - parse failure (body / verdict null) → 同上
 *   - NO_OP → sha bookmark のみ (iteration 据え置き)
 *   - REQUEST_CHANGES → post + state 更新 + iteration++
 *   - APPROVE → post + state 更新 + iteration=0 (reset)
 */

import { describe, expect, it } from "vitest";

import type { ClaudeRunResult } from "./claude.js";
import { runReviewJob, type ReviewJobDeps, type ReviewJobInput } from "./review-job.js";
import { type State } from "./state.js";
import type { Worktree } from "./worktree.js";

interface Harness {
  state: State;
  posted: Array<{ repo: string; prNumber: number; body: string }>;
  worktreeOps: string[];
}

function makeDeps(
  stdout: string,
  opts: { exitCode?: number; timedOut?: boolean } = {},
): {
  deps: ReviewJobDeps;
  harness: Harness;
} {
  const harness: Harness = { state: { prs: {} }, posted: [], worktreeOps: [] };
  const fakeWorktree: Worktree = { path: "/tmp/fake-wt", prNumber: 0 };
  const deps: ReviewJobDeps = {
    runClaude: async (): Promise<ClaudeRunResult> => ({
      stdout,
      stderr: "",
      exitCode: opts.exitCode ?? 0,
      timedOut: opts.timedOut ?? false,
    }),
    postPRComment: async (repo, prNumber, body) => {
      harness.posted.push({ repo, prNumber, body });
    },
    createWorktree: async (_repoRoot, prNumber) => {
      harness.worktreeOps.push(`create-${prNumber}`);
      return { ...fakeWorktree, prNumber };
    },
    removeWorktree: async (_repoRoot, wt) => {
      harness.worktreeOps.push(`remove-${wt.prNumber}`);
    },
  };
  return { deps, harness };
}

function makeInput(
  state: State,
  headSha = "abc123",
): {
  input: ReviewJobInput;
  getState: () => State;
} {
  let current = state;
  const input: ReviewJobInput = {
    prNumber: 7,
    headSha,
    repo: "thujikun/self-management",
    repoRoot: "/repo",
    state: current,
    updateState: async (updater) => {
      current = updater(current);
      return current;
    },
  };
  return { input, getState: () => current };
}

describe("runReviewJob", () => {
  it("timeout: sha bookmark + iteration++ (anti-loop)、本文 post なし", async () => {
    const { deps, harness } = makeDeps("", { timedOut: true });
    const { input, getState } = makeInput({ prs: { "7": { iterations: 1 } } });
    await runReviewJob(input, deps);
    expect(harness.posted).toStrictEqual([]);
    expect(getState().prs["7"]?.lastReviewedSha).toStrictEqual("abc123");
    expect(getState().prs["7"]?.iterations).toStrictEqual(2);
    expect(harness.worktreeOps).toStrictEqual(["create-7", "remove-7"]);
  });

  it("parse failure (body / verdict 不在): sha bookmark + iteration++", async () => {
    const { deps, harness } = makeDeps("totally garbage output");
    const { input, getState } = makeInput({ prs: {} });
    await runReviewJob(input, deps);
    expect(harness.posted).toStrictEqual([]);
    const after = getState().prs["7"];
    expect(after?.lastReviewedSha).toStrictEqual("abc123");
    expect(after?.iterations).toStrictEqual(1);
    expect(after?.lastReviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("NO_OP: sha bookmark のみ、iteration 据え置き、post なし", async () => {
    const { deps, harness } = makeDeps("<!-- VERDICT:NO_OP -->\n");
    const { input, getState } = makeInput({ prs: { "7": { iterations: 3 } } });
    await runReviewJob(input, deps);
    expect(harness.posted).toStrictEqual([]);
    expect(getState().prs["7"]?.lastReviewedSha).toStrictEqual("abc123");
    expect(getState().prs["7"]?.iterations).toStrictEqual(3);
  });

  it("REQUEST_CHANGES: comment 投稿 + sha + body hash + iteration++", async () => {
    const stdout = [
      "<!-- AUTO_REVIEW_BODY_START -->",
      "## Major\n- foo.ts:42 で X",
      "<!-- AUTO_REVIEW_BODY_END -->",
      "<!-- VERDICT:REQUEST_CHANGES -->",
    ].join("\n");
    const { deps, harness } = makeDeps(stdout);
    const { input, getState } = makeInput({ prs: { "7": { iterations: 2 } } });
    await runReviewJob(input, deps);
    expect(harness.posted).toStrictEqual([
      {
        repo: "thujikun/self-management",
        prNumber: 7,
        body: [
          "<!-- AUTO_REVIEW_BODY_START -->",
          "## Major\n- foo.ts:42 で X",
          "<!-- AUTO_REVIEW_BODY_END -->",
          "<!-- VERDICT:REQUEST_CHANGES -->",
        ].join("\n"),
      },
    ]);
    expect(getState().prs["7"]?.iterations).toStrictEqual(3);
    expect(getState().prs["7"]?.lastReviewedSha).toStrictEqual("abc123");
    expect(getState().prs["7"]?.lastReviewBodyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("APPROVE: comment 投稿 + iteration=0 reset", async () => {
    const stdout = [
      "<!-- AUTO_REVIEW_BODY_START -->",
      "指摘なし、6 gate green",
      "<!-- AUTO_REVIEW_BODY_END -->",
      "<!-- VERDICT:APPROVE -->",
    ].join("\n");
    const { deps, harness } = makeDeps(stdout);
    const { input, getState } = makeInput({ prs: { "7": { iterations: 7 } } });
    await runReviewJob(input, deps);
    expect(harness.posted).toHaveLength(1);
    expect(getState().prs["7"]?.iterations).toStrictEqual(0);
  });

  it("worktree は finally 節で必ず削除される (post で throw しても)", async () => {
    const stdout = [
      "<!-- AUTO_REVIEW_BODY_START -->",
      "x",
      "<!-- AUTO_REVIEW_BODY_END -->",
      "<!-- VERDICT:REQUEST_CHANGES -->",
    ].join("\n");
    const { deps, harness } = makeDeps(stdout);
    const failingDeps: ReviewJobDeps = {
      ...deps,
      postPRComment: async () => {
        throw new Error("network down");
      },
    };
    const { input } = makeInput({ prs: {} });
    await expect(runReviewJob(input, failingDeps)).rejects.toThrow("network down");
    expect(harness.worktreeOps).toStrictEqual(["create-7", "remove-7"]);
  });
});
