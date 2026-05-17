/**
 * conflict-fix-job.ts の path 別 test。
 *
 * 検証する分岐:
 *   - timeout → 失敗記録 (conflictFixFailureCount, lastFailedConflictFixSha, lastConflictFixFailedAt)、SHA bookmark しない
 *   - FIX_FAILED marker → 同上
 *   - push 検出失敗 → 同上
 *   - push 検出成功 → success として state 更新 + iteration++
 *   - 同 SHA で連続失敗 → conflictFixFailureCount が積み上がる
 *   - 失敗 → 成功で failure fields クリア
 *   - worktree は finally で必ず削除
 */

import { describe, expect, it } from "vitest";

import type { ClaudeRunResult } from "./claude.js";
import {
  runConflictFixJob,
  type ConflictFixJobDeps,
  type ConflictFixJobInput,
} from "./conflict-fix-job.js";
import { type State } from "./state.js";
import type { Worktree } from "./worktree.js";

interface Harness {
  worktreeOps: string[];
  fetched: string[];
}

function makeDeps(
  stdout: string,
  shas: { before: string; after: string; origin: string },
  opts: { exitCode?: number; timedOut?: boolean; mergeFailed?: boolean } = {},
): { deps: ConflictFixJobDeps; harness: Harness } {
  const harness: Harness = { worktreeOps: [], fetched: [] };
  const fakeWorktree: Worktree = { path: "/tmp/fake-conflict-fix-wt", prNumber: 0 };
  // revParse の連続呼び出しに対する response (HEAD は before → after の 2 回呼ばれる)
  const headResponses = [shas.before, shas.after];
  let headIdx = 0;
  const deps: ConflictFixJobDeps = {
    runClaude: async (): Promise<ClaudeRunResult> => ({
      stdout,
      stderr: "",
      exitCode: opts.exitCode ?? 0,
      timedOut: opts.timedOut ?? false,
    }),
    createWorktree: async (_repoRoot, prNumber, _branch) => {
      harness.worktreeOps.push(`create-${prNumber}`);
      return { wt: { ...fakeWorktree, prNumber }, mergeFailed: opts.mergeFailed ?? true };
    },
    removeWorktree: async (_repoRoot, wt) => {
      harness.worktreeOps.push(`remove-${wt.prNumber}`);
    },
    revParse: async (_path, ref) => {
      if (ref === "HEAD") return headResponses[Math.min(headIdx++, headResponses.length - 1)];
      return shas.origin;
    },
    fetchOriginBranch: async (_path, branch) => {
      harness.fetched.push(branch);
    },
  };
  return { deps, harness };
}

function makeInput(
  state: State,
  headSha = "abc1234",
): {
  input: ConflictFixJobInput;
  getState: () => State;
} {
  let current = state;
  const input: ConflictFixJobInput = {
    prNumber: 9,
    headSha,
    repo: "thujikun/self-management",
    repoRoot: "/repo",
    branch: "feat/sample",
    state: current,
    updateState: async (updater) => {
      current = updater(current);
      return current;
    },
  };
  return { input, getState: () => current };
}

describe("runConflictFixJob", () => {
  it("timeout: 失敗記録 (sha bookmark せず、iteration 据え置き)", async () => {
    const { deps, harness } = makeDeps(
      "",
      { before: "AAA", after: "AAA", origin: "AAA" },
      { timedOut: true },
    );
    const { input, getState } = makeInput({ prs: { "9": { iterations: 1 } } });
    await runConflictFixJob(input, deps);
    const after = getState().prs["9"];
    expect(after?.lastConflictFixedSha).toStrictEqual(undefined);
    expect(after?.iterations).toStrictEqual(1);
    expect(after?.conflictFixFailureCount).toStrictEqual(1);
    expect(after?.lastFailedConflictFixSha).toStrictEqual("abc1234");
    expect(after?.lastConflictFixFailedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(harness.fetched).toStrictEqual([]);
    expect(harness.worktreeOps).toStrictEqual(["create-9", "remove-9"]);
  });

  it("exit !=0 (runtime failure): parse 試行せず record、push 検証 skip", async () => {
    const { deps, harness } = makeDeps(
      "Invalid API key",
      { before: "AAA", after: "AAA", origin: "AAA" },
      { exitCode: 1 },
    );
    const { input, getState } = makeInput({ prs: { "9": { iterations: 2 } } });
    await runConflictFixJob(input, deps);
    const after = getState().prs["9"];
    expect(after?.lastConflictFixedSha).toStrictEqual(undefined);
    expect(after?.iterations).toStrictEqual(2);
    expect(after?.conflictFixFailureCount).toStrictEqual(1);
    expect(after?.lastFailedConflictFixSha).toStrictEqual("abc1234");
    expect(harness.fetched).toStrictEqual([]);
  });

  it("FIX_FAILED: 失敗記録のみ (sha bookmark せず)、push 検証 skip", async () => {
    const { deps, harness } = makeDeps("<!-- FIX_FAILED:意味的判断不可 -->\n", {
      before: "AAA",
      after: "AAA",
      origin: "AAA",
    });
    const { input, getState } = makeInput({ prs: {} });
    await runConflictFixJob(input, deps);
    const after = getState().prs["9"];
    expect(after?.lastConflictFixedSha).toStrictEqual(undefined);
    expect(after?.conflictFixFailureCount).toStrictEqual(1);
    expect(after?.lastFailedConflictFixSha).toStrictEqual("abc1234");
    expect(harness.fetched).toStrictEqual([]);
  });

  it("push 検出失敗 (HEAD 不変): success にせず失敗記録", async () => {
    const { deps, harness } = makeDeps("", { before: "AAA", after: "AAA", origin: "AAA" });
    const { input, getState } = makeInput({ prs: { "9": { iterations: 0 } } });
    await runConflictFixJob(input, deps);
    const after = getState().prs["9"];
    expect(after?.lastConflictFixedSha).toStrictEqual(undefined);
    expect(after?.conflictFixFailureCount).toStrictEqual(1);
    expect(harness.fetched).toStrictEqual(["feat/sample"]);
  });

  it("push 検出失敗 (HEAD は動いたが origin に未反映): 同上", async () => {
    const { deps } = makeDeps("", { before: "AAA", after: "BBB", origin: "AAA" });
    const { input, getState } = makeInput({ prs: {} });
    await runConflictFixJob(input, deps);
    expect(getState().prs["9"]?.conflictFixFailureCount).toStrictEqual(1);
  });

  it("同 SHA で連続失敗: conflictFixFailureCount が積み上がる", async () => {
    const { deps } = makeDeps("<!-- FIX_FAILED:still bad -->\n", {
      before: "AAA",
      after: "AAA",
      origin: "AAA",
    });
    const { input, getState } = makeInput({
      prs: {
        "9": {
          iterations: 0,
          conflictFixFailureCount: 2,
          lastFailedConflictFixSha: "abc1234",
          lastConflictFixFailedAt: "2026-05-10T00:00:00.000Z",
        },
      },
    });
    await runConflictFixJob(input, deps);
    expect(getState().prs["9"]?.conflictFixFailureCount).toStrictEqual(3);
  });

  it("失敗 SHA が変わる: conflictFixFailureCount が 1 から再カウント", async () => {
    const { deps } = makeDeps("<!-- FIX_FAILED:other -->\n", {
      before: "AAA",
      after: "AAA",
      origin: "AAA",
    });
    const { input, getState } = makeInput(
      {
        prs: {
          "9": {
            iterations: 0,
            conflictFixFailureCount: 5,
            lastFailedConflictFixSha: "old_sha",
            lastConflictFixFailedAt: "2026-05-10T00:00:00.000Z",
          },
        },
      },
      "new_sha",
    );
    await runConflictFixJob(input, deps);
    expect(getState().prs["9"]?.conflictFixFailureCount).toStrictEqual(1);
    expect(getState().prs["9"]?.lastFailedConflictFixSha).toStrictEqual("new_sha");
  });

  it("push 検出成功: bookmark + iteration++", async () => {
    const { deps, harness } = makeDeps("", { before: "AAA", after: "BBB", origin: "BBB" });
    const { input, getState } = makeInput({ prs: { "9": { iterations: 2 } } });
    await runConflictFixJob(input, deps);
    const after = getState().prs["9"];
    expect(after?.lastConflictFixedSha).toStrictEqual("abc1234");
    expect(after?.lastConflictFixedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(after?.iterations).toStrictEqual(3);
    expect(harness.fetched).toStrictEqual(["feat/sample"]);
  });

  it("失敗 → 成功で failure 系 fields がクリアされる", async () => {
    const { deps } = makeDeps("", { before: "AAA", after: "BBB", origin: "BBB" });
    const { input, getState } = makeInput({
      prs: {
        "9": {
          iterations: 0,
          conflictFixFailureCount: 2,
          lastFailedConflictFixSha: "abc1234",
          lastConflictFixFailedAt: "2026-05-10T00:00:00.000Z",
        },
      },
    });
    await runConflictFixJob(input, deps);
    const after = getState().prs["9"];
    expect(after?.lastConflictFixedSha).toStrictEqual("abc1234");
    expect(after?.conflictFixFailureCount).toStrictEqual(undefined);
    expect(after?.lastFailedConflictFixSha).toStrictEqual(undefined);
    expect(after?.lastConflictFixFailedAt).toStrictEqual(undefined);
  });

  it("Claude spawn が throw: 失敗記録 (iteration 据え置き)、worktree は finally 削除", async () => {
    const { deps, harness } = makeDeps("", { before: "AAA", after: "AAA", origin: "AAA" });
    const failingDeps: ConflictFixJobDeps = {
      ...deps,
      runClaude: async () => {
        throw new Error("spawn failed");
      },
    };
    const { input, getState } = makeInput({ prs: { "9": { iterations: 0 } } });
    await runConflictFixJob(input, failingDeps);
    expect(harness.worktreeOps).toStrictEqual(["create-9", "remove-9"]);
    expect(getState().prs["9"]?.conflictFixFailureCount).toStrictEqual(1);
    expect(getState().prs["9"]?.iterations).toStrictEqual(0);
  });

  it("createWorktree が throw: 失敗記録 (iteration 据え置き)、worktree 削除呼び出し無し", async () => {
    const { deps, harness } = makeDeps("", { before: "AAA", after: "AAA", origin: "AAA" });
    const failingDeps: ConflictFixJobDeps = {
      ...deps,
      createWorktree: async () => {
        throw new Error("fatal: branch is already used");
      },
    };
    const { input, getState } = makeInput({ prs: { "9": { iterations: 0 } } });
    await runConflictFixJob(input, failingDeps);
    expect(harness.worktreeOps).toStrictEqual([]);
    expect(getState().prs["9"]?.conflictFixFailureCount).toStrictEqual(1);
  });

  it("mergeFailed=false (poll〜worktree 作成の間に GH 側で conflict 解消されていた case): AI に渡す prompt 分岐", async () => {
    // この test は mergeAttempted=false branch を踏むだけ。後段 (push 検出無し) は同じ。
    const { deps } = makeDeps(
      "",
      { before: "AAA", after: "AAA", origin: "AAA" },
      { mergeFailed: false },
    );
    const { input, getState } = makeInput({ prs: {} });
    await runConflictFixJob(input, deps);
    expect(getState().prs["9"]?.conflictFixFailureCount).toStrictEqual(1);
  });
});
