/**
 * review-job.ts の path 別 test。副作用は dep injection で fake、state 遷移を assertion する。
 *
 * 検証する分岐:
 *   - timeout → 失敗記録 (reviewFailureCount, lastFailedReviewSha, lastReviewFailedAt)、SHA bookmark しない
 *   - parse failure (body / verdict null) → 同上
 *   - NO_OP → sha bookmark のみ (iteration 据え置き)
 *   - REQUEST_CHANGES → post + state 更新 + iteration++
 *   - APPROVE → post + state 更新 + iteration=0 (reset)
 *   - 失敗が同 SHA で連続 → reviewFailureCount が積み上がる
 *   - 失敗 SHA が変わる → reviewFailureCount は 1 から再カウント
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
  it("timeout: 失敗記録のみ (SHA bookmark せず、iteration 据え置き)、post なし", async () => {
    const { deps, harness } = makeDeps("", { timedOut: true });
    const { input, getState } = makeInput({ prs: { "7": { iterations: 1 } } });
    await runReviewJob(input, deps);
    expect(harness.posted).toStrictEqual([]);
    const after = getState().prs["7"];
    expect(after?.lastReviewedSha).toStrictEqual(undefined);
    expect(after?.iterations).toStrictEqual(1);
    expect(after?.reviewFailureCount).toStrictEqual(1);
    expect(after?.lastFailedReviewSha).toStrictEqual("abc123");
    expect(after?.lastReviewFailedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(harness.worktreeOps).toStrictEqual(["create-7", "remove-7"]);
  });

  it("parse failure (body / verdict 不在): 失敗記録のみ (SHA bookmark せず)", async () => {
    const { deps, harness } = makeDeps("totally garbage output");
    const { input, getState } = makeInput({ prs: {} });
    await runReviewJob(input, deps);
    expect(harness.posted).toStrictEqual([]);
    const after = getState().prs["7"];
    expect(after?.lastReviewedSha).toStrictEqual(undefined);
    expect(after?.reviewFailureCount).toStrictEqual(1);
    expect(after?.lastFailedReviewSha).toStrictEqual("abc123");
    expect(after?.lastReviewFailedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("同 SHA で連続失敗: reviewFailureCount が積み上がる", async () => {
    const { deps } = makeDeps("garbage 1");
    const { input, getState } = makeInput({
      prs: {
        "7": {
          iterations: 0,
          reviewFailureCount: 2,
          lastFailedReviewSha: "abc123",
          lastReviewFailedAt: "2026-05-10T00:00:00.000Z",
        },
      },
    });
    await runReviewJob(input, deps);
    expect(getState().prs["7"]?.reviewFailureCount).toStrictEqual(3);
    expect(getState().prs["7"]?.lastFailedReviewSha).toStrictEqual("abc123");
  });

  it("失敗 SHA が変わる: reviewFailureCount が 1 から再カウント", async () => {
    const { deps } = makeDeps("garbage");
    const { input, getState } = makeInput(
      {
        prs: {
          "7": {
            iterations: 0,
            reviewFailureCount: 5,
            lastFailedReviewSha: "old_sha",
            lastReviewFailedAt: "2026-05-10T00:00:00.000Z",
          },
        },
      },
      "new_sha",
    );
    await runReviewJob(input, deps);
    expect(getState().prs["7"]?.reviewFailureCount).toStrictEqual(1);
    expect(getState().prs["7"]?.lastFailedReviewSha).toStrictEqual("new_sha");
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

  it("失敗 → 成功 (REQUEST_CHANGES) で failure 系 fields がクリアされる", async () => {
    const stdout = [
      "<!-- AUTO_REVIEW_BODY_START -->",
      "## Major\n- foo.ts:1 で X",
      "<!-- AUTO_REVIEW_BODY_END -->",
      "<!-- VERDICT:REQUEST_CHANGES -->",
    ].join("\n");
    const { deps } = makeDeps(stdout);
    const { input, getState } = makeInput({
      prs: {
        "7": {
          iterations: 0,
          reviewFailureCount: 2,
          lastFailedReviewSha: "abc123",
          lastReviewFailedAt: "2026-05-10T00:00:00.000Z",
        },
      },
    });
    await runReviewJob(input, deps);
    const after = getState().prs["7"];
    expect(after?.lastReviewedSha).toStrictEqual("abc123");
    expect(after?.reviewFailureCount).toStrictEqual(undefined);
    expect(after?.lastFailedReviewSha).toStrictEqual(undefined);
    expect(after?.lastReviewFailedAt).toStrictEqual(undefined);
  });

  it("失敗 → 成功 (NO_OP) でも failure 系 fields がクリアされる", async () => {
    const { deps } = makeDeps("<!-- VERDICT:NO_OP -->\n");
    const { input, getState } = makeInput({
      prs: {
        "7": {
          iterations: 0,
          reviewFailureCount: 1,
          lastFailedReviewSha: "abc123",
          lastReviewFailedAt: "2026-05-10T00:00:00.000Z",
        },
      },
    });
    await runReviewJob(input, deps);
    const after = getState().prs["7"];
    expect(after?.reviewFailureCount).toStrictEqual(undefined);
    expect(after?.lastFailedReviewSha).toStrictEqual(undefined);
    expect(after?.lastReviewFailedAt).toStrictEqual(undefined);
  });

  it("post が throw: 失敗記録 (iteration 据え置き)、worktree は finally 削除", async () => {
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
    const { input, getState } = makeInput({ prs: { "7": { iterations: 0 } } });
    await runReviewJob(input, failingDeps);
    expect(harness.worktreeOps).toStrictEqual(["create-7", "remove-7"]);
    const after = getState().prs["7"];
    expect(after?.lastReviewedSha).toStrictEqual(undefined);
    expect(after?.iterations).toStrictEqual(0);
    expect(after?.reviewFailureCount).toStrictEqual(1);
  });

  it("createWorktree が throw: 失敗記録 (iteration 据え置き)、remove 呼ばれず", async () => {
    const { deps, harness } = makeDeps("");
    const failingDeps: ReviewJobDeps = {
      ...deps,
      createWorktree: async () => {
        throw new Error("fatal: branch already in use");
      },
    };
    const { input, getState } = makeInput({ prs: {} });
    await runReviewJob(input, failingDeps);
    expect(harness.worktreeOps).toStrictEqual([]);
    const after = getState().prs["7"];
    expect(after?.lastReviewedSha).toStrictEqual(undefined);
    expect(after?.iterations).toStrictEqual(0);
    expect(after?.reviewFailureCount).toStrictEqual(1);
  });
});
