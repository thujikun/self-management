/**
 * merge-job.ts の path 別 test。CI チェック / merge コマンドの副作用は dep injection で fake、
 * state 遷移と返り値 (`merged` flag) を assertion する。
 */

import { describe, expect, it } from "vitest";

import {
  isHeadOutOfDateError,
  runMergeJob,
  type MergeJobDeps,
  type MergeJobInput,
} from "./merge-job.js";
import { type State } from "./state.js";

interface Harness {
  ciCalls: Array<{ repo: string; prNumber: number }>;
  mergeCalls: Array<{ repo: string; prNumber: number }>;
  updateBranchCalls: Array<{ repo: string; prNumber: number }>;
}

function makeDeps(opts: {
  ciAllPass: boolean | (() => Promise<boolean>);
  mergeError?: Error;
  updateBranchError?: Error;
}): {
  deps: MergeJobDeps;
  harness: Harness;
} {
  const harness: Harness = { ciCalls: [], mergeCalls: [], updateBranchCalls: [] };
  const deps: MergeJobDeps = {
    ciAllPass: async (repo, prNumber) => {
      harness.ciCalls.push({ repo, prNumber });
      return typeof opts.ciAllPass === "function" ? await opts.ciAllPass() : opts.ciAllPass;
    },
    mergeSquash: async (repo, prNumber) => {
      harness.mergeCalls.push({ repo, prNumber });
      if (opts.mergeError) throw opts.mergeError;
    },
    updateBranch: async (repo, prNumber) => {
      harness.updateBranchCalls.push({ repo, prNumber });
      if (opts.updateBranchError) throw opts.updateBranchError;
    },
  };
  return { deps, harness };
}

function makeInput(
  state: State,
  headSha = "abcdef",
): {
  input: MergeJobInput;
  getState: () => State;
} {
  let current = state;
  const input: MergeJobInput = {
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

describe("runMergeJob", () => {
  it("CI 未 pass (防御的 re-check fail): merge 呼ばれず state 不変 (poll 側で gate されるので no-op)", async () => {
    const { deps, harness } = makeDeps({ ciAllPass: false });
    const { input, getState } = makeInput({ prs: { "9": { iterations: 2 } } });
    const result = await runMergeJob(input, deps);
    expect(result.merged).toStrictEqual(false);
    expect(harness.mergeCalls).toStrictEqual([]);
    // CI 失敗は ci-fix mode が担当するので merge job では state 不変
    expect(getState().prs["9"]?.iterations).toStrictEqual(2);
  });

  it("CI pass: mergeSquash 成功 → state.lastMergedSha + lastMergedAt bookmark + merged=true", async () => {
    const { deps, harness } = makeDeps({ ciAllPass: true });
    const { input, getState } = makeInput({ prs: { "9": { iterations: 1 } } }, "newsha");
    const result = await runMergeJob(input, deps);
    expect(result.merged).toStrictEqual(true);
    expect(harness.mergeCalls).toStrictEqual([{ repo: "thujikun/self-management", prNumber: 9 }]);
    const after = getState().prs["9"];
    expect(after?.lastMergedSha).toStrictEqual("newsha");
    expect(after?.lastMergedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // iterations は merge job では触らない
    expect(after?.iterations).toStrictEqual(1);
  });

  it("CI pass + mergeSquash throw (head not up to date): updateBranch を自動呼び出し、merged=false", async () => {
    const { deps, harness } = makeDeps({
      ciAllPass: true,
      mergeError: new Error(
        "gh pr merge 33 --repo thujikun/self-management --squash --delete-branch exit 1\n" +
          "X Pull request thujikun/self-management#33 is not mergeable: the head branch is not up to date with the base branch.",
      ),
    });
    const { input, getState } = makeInput({ prs: { "9": { iterations: 0 } } });
    const result = await runMergeJob(input, deps);
    expect(result.merged).toStrictEqual(false);
    expect(harness.mergeCalls).toHaveLength(1);
    expect(harness.updateBranchCalls).toStrictEqual([
      { repo: "thujikun/self-management", prNumber: 9 },
    ]);
    // state は不変 (新 SHA で reviewer / merge が再評価する)
    expect(getState().prs["9"]?.lastMergedSha).toStrictEqual(undefined);
  });

  it("CI pass + mergeSquash throw (head out of date) + updateBranch も throw: state 不変、warn のみ", async () => {
    const { deps, harness } = makeDeps({
      ciAllPass: true,
      mergeError: new Error("Pull request is not mergeable: head branch is not up to date"),
      updateBranchError: new Error("API rate limit hit"),
    });
    const { input, getState } = makeInput({ prs: { "9": { iterations: 0 } } });
    const result = await runMergeJob(input, deps);
    expect(result.merged).toStrictEqual(false);
    expect(harness.updateBranchCalls).toHaveLength(1);
    expect(getState().prs["9"]?.lastMergedSha).toStrictEqual(undefined);
  });

  it("CI pass + mergeSquash throw (他 branch protection 系、out-of-date 以外): updateBranch 呼ばれず", async () => {
    const { deps, harness } = makeDeps({
      ciAllPass: true,
      mergeError: new Error("required status checks not satisfied"),
    });
    const { input, getState } = makeInput({ prs: { "9": { iterations: 0 } } });
    const result = await runMergeJob(input, deps);
    expect(result.merged).toStrictEqual(false);
    expect(harness.updateBranchCalls).toStrictEqual([]);
    expect(getState().prs["9"]?.lastMergedSha).toStrictEqual(undefined);
  });

  it("ciAllPass が throw しても merged=false、state 不変 (poll 側で再判定)", async () => {
    const { deps, harness } = makeDeps({
      ciAllPass: async () => {
        throw new Error("network down");
      },
    });
    const { input, getState } = makeInput({ prs: { "9": { iterations: 1 } } });
    const result = await runMergeJob(input, deps);
    expect(result.merged).toStrictEqual(false);
    expect(harness.mergeCalls).toStrictEqual([]);
    expect(getState().prs["9"]?.iterations).toStrictEqual(1);
  });
});

describe("isHeadOutOfDateError", () => {
  it("実際の gh pr merge 失敗 message を match", () => {
    expect(
      isHeadOutOfDateError(
        "X Pull request thujikun/self-management#33 is not mergeable: the head branch is not up to date with the base branch.",
      ),
    ).toStrictEqual(true);
  });

  it("大文字小文字混じり、行頭以外でも match", () => {
    expect(isHeadOutOfDateError("HEAD branch is NOT up to date")).toStrictEqual(true);
  });

  it("他の branch protection エラー (required reviews 等) は match しない", () => {
    expect(isHeadOutOfDateError("required status checks not satisfied")).toStrictEqual(false);
    expect(isHeadOutOfDateError("at least 1 approving review required")).toStrictEqual(false);
  });

  it("空文字 / 関係ない文言は match しない", () => {
    expect(isHeadOutOfDateError("")).toStrictEqual(false);
    expect(isHeadOutOfDateError("network down")).toStrictEqual(false);
  });
});
