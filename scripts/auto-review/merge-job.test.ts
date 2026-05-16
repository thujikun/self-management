/**
 * merge-job.ts の path 別 test。CI チェック / merge コマンドの副作用は dep injection で fake、
 * state 遷移と返り値 (`merged` flag) を assertion する。
 */

import { describe, expect, it } from "vitest";

import { runMergeJob, type MergeJobDeps, type MergeJobInput } from "./merge-job.js";
import { type State } from "./state.js";

interface Harness {
  ciCalls: Array<{ repo: string; prNumber: number }>;
  mergeCalls: Array<{ repo: string; prNumber: number }>;
}

function makeDeps(opts: { ciAllPass: boolean | (() => Promise<boolean>); mergeError?: Error }): {
  deps: MergeJobDeps;
  harness: Harness;
} {
  const harness: Harness = { ciCalls: [], mergeCalls: [] };
  const deps: MergeJobDeps = {
    ciAllPass: async (repo, prNumber) => {
      harness.ciCalls.push({ repo, prNumber });
      return typeof opts.ciAllPass === "function" ? await opts.ciAllPass() : opts.ciAllPass;
    },
    mergeSquash: async (repo, prNumber) => {
      harness.mergeCalls.push({ repo, prNumber });
      if (opts.mergeError) throw opts.mergeError;
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

  it("CI pass + mergeSquash throw (branch protection 等): state 不変、merged=false", async () => {
    const { deps, harness } = makeDeps({
      ciAllPass: true,
      mergeError: new Error("Branch is not up to date"),
    });
    const { input, getState } = makeInput({ prs: { "9": { iterations: 0 } } });
    const result = await runMergeJob(input, deps);
    expect(result.merged).toStrictEqual(false);
    expect(harness.mergeCalls).toHaveLength(1);
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
