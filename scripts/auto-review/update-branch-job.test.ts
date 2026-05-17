/**
 * update-branch-job.ts の path 別 test。`gh pr update-branch` の副作用は dep injection で fake、
 * state 遷移と `updated` flag を assertion する。
 */

import { describe, expect, it } from "vitest";

import { type State } from "./state.js";
import {
  runUpdateBranchJob,
  type UpdateBranchJobDeps,
  type UpdateBranchJobInput,
} from "./update-branch-job.js";

interface Harness {
  updateBranchCalls: Array<{ repo: string; prNumber: number }>;
}

function makeDeps(opts: { updateBranchError?: Error }): {
  deps: UpdateBranchJobDeps;
  harness: Harness;
} {
  const harness: Harness = { updateBranchCalls: [] };
  const deps: UpdateBranchJobDeps = {
    updateBranch: async (repo, prNumber) => {
      harness.updateBranchCalls.push({ repo, prNumber });
      if (opts.updateBranchError) throw opts.updateBranchError;
    },
  };
  return { deps, harness };
}

function makeInput(
  state: State,
  headSha = "abcdef0",
): {
  input: UpdateBranchJobInput;
  getState: () => State;
} {
  let current = state;
  const input: UpdateBranchJobInput = {
    prNumber: 9,
    headSha,
    repo: "thujikun/self-management",
    state: current,
    updateState: async (updater) => {
      current = updater(current);
      return current;
    },
  };
  return { input, getState: () => current };
}

describe("runUpdateBranchJob", () => {
  it("成功: gh pr update-branch 1 回呼ばれて bookmark + updated=true", async () => {
    const { deps, harness } = makeDeps({});
    const { input, getState } = makeInput({ prs: { "9": { iterations: 1 } } }, "newsha");
    const result = await runUpdateBranchJob(input, deps);
    expect(result.updated).toStrictEqual(true);
    expect(harness.updateBranchCalls).toStrictEqual([
      { repo: "thujikun/self-management", prNumber: 9 },
    ]);
    const after = getState().prs["9"];
    expect(after?.lastUpdateBranchedSha).toStrictEqual("newsha");
    expect(after?.lastUpdateBranchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // iterations は update-branch では触らない
    expect(after?.iterations).toStrictEqual(1);
  });

  it("失敗: 失敗記録のみ (sha bookmark せず)、updated=false", async () => {
    const { deps, harness } = makeDeps({ updateBranchError: new Error("API rate limit hit") });
    const { input, getState } = makeInput({ prs: { "9": { iterations: 0 } } }, "abc1234");
    const result = await runUpdateBranchJob(input, deps);
    expect(result.updated).toStrictEqual(false);
    expect(harness.updateBranchCalls).toHaveLength(1);
    const after = getState().prs["9"];
    expect(after?.lastUpdateBranchedSha).toStrictEqual(undefined);
    expect(after?.updateBranchFailureCount).toStrictEqual(1);
    expect(after?.lastFailedUpdateBranchSha).toStrictEqual("abc1234");
    expect(after?.lastUpdateBranchFailedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("同 SHA で連続失敗: updateBranchFailureCount が積み上がる", async () => {
    const { deps } = makeDeps({ updateBranchError: new Error("conflict somewhere") });
    const { input, getState } = makeInput(
      {
        prs: {
          "9": {
            iterations: 0,
            updateBranchFailureCount: 2,
            lastFailedUpdateBranchSha: "abc1234",
            lastUpdateBranchFailedAt: "2026-05-10T00:00:00.000Z",
          },
        },
      },
      "abc1234",
    );
    await runUpdateBranchJob(input, deps);
    const after = getState().prs["9"];
    expect(after?.updateBranchFailureCount).toStrictEqual(3);
    expect(after?.lastFailedUpdateBranchSha).toStrictEqual("abc1234");
  });

  it("失敗 SHA が変わる: updateBranchFailureCount が 1 から再カウント", async () => {
    const { deps } = makeDeps({ updateBranchError: new Error("err") });
    const { input, getState } = makeInput(
      {
        prs: {
          "9": {
            iterations: 0,
            updateBranchFailureCount: 5,
            lastFailedUpdateBranchSha: "old_sha",
            lastUpdateBranchFailedAt: "2026-05-10T00:00:00.000Z",
          },
        },
      },
      "new_sha",
    );
    await runUpdateBranchJob(input, deps);
    expect(getState().prs["9"]?.updateBranchFailureCount).toStrictEqual(1);
    expect(getState().prs["9"]?.lastFailedUpdateBranchSha).toStrictEqual("new_sha");
  });

  it("失敗 → 成功で failure 系 fields がクリアされる", async () => {
    const { deps } = makeDeps({});
    const { input, getState } = makeInput(
      {
        prs: {
          "9": {
            iterations: 0,
            updateBranchFailureCount: 2,
            lastFailedUpdateBranchSha: "abc1234",
            lastUpdateBranchFailedAt: "2026-05-10T00:00:00.000Z",
          },
        },
      },
      "abc1234",
    );
    await runUpdateBranchJob(input, deps);
    const after = getState().prs["9"];
    expect(after?.lastUpdateBranchedSha).toStrictEqual("abc1234");
    expect(after?.updateBranchFailureCount).toStrictEqual(undefined);
    expect(after?.lastFailedUpdateBranchSha).toStrictEqual(undefined);
    expect(after?.lastUpdateBranchFailedAt).toStrictEqual(undefined);
  });
});
