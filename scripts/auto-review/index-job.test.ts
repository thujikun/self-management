/**
 * index-job.ts の path 別 test。git fetch / spawn は dep injection で fake、global state 遷移と
 * `kicked` flag を assertion する。
 */

import { describe, expect, it } from "vitest";

import { runIndexJob, type IndexJobDeps, type IndexJobInput } from "./index-job.js";
import { type State } from "./state.js";

interface Harness {
  shaQueries: number;
  spawnedFor: string[];
  /** state update / spawn の順序を観測するための time-ordered event log */
  events: Array<"state-updated" | "spawned">;
}

function makeDeps(shaProvider: () => Promise<string>): { deps: IndexJobDeps; harness: Harness } {
  const harness: Harness = { shaQueries: 0, spawnedFor: [], events: [] };
  const deps: IndexJobDeps = {
    getOriginMainSha: async (_repoRoot) => {
      harness.shaQueries++;
      return shaProvider();
    },
    spawnGraphBuild: (repoRoot) => {
      harness.spawnedFor.push(repoRoot);
      harness.events.push("spawned");
    },
  };
  return { deps, harness };
}

function makeInput(
  state: State,
  recordEvents?: Array<"state-updated" | "spawned">,
): { input: IndexJobInput; getState: () => State } {
  let current = state;
  const input: IndexJobInput = {
    repoRoot: "/repo",
    state: current,
    updateState: async (updater) => {
      current = updater(current);
      recordEvents?.push("state-updated");
      return current;
    },
  };
  return { input, getState: () => current };
}

describe("runIndexJob", () => {
  it("初回 (state.global 未設定): spawn + lastIndexedMainSha 記録、state update が spawn より先", async () => {
    const { deps, harness } = makeDeps(async () => "main-sha-1");
    const { input, getState } = makeInput({ prs: {} }, harness.events);
    const result = await runIndexJob(input, deps);
    expect(result.kicked).toStrictEqual(true);
    expect(harness.spawnedFor).toStrictEqual(["/repo"]);
    expect(getState().global?.lastIndexedMainSha).toStrictEqual("main-sha-1");
    expect(getState().global?.lastIndexedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // state-updated → spawned の順序を厳密に固定 (race window で duplicate kick が起きないため)
    expect(harness.events).toStrictEqual(["state-updated", "spawned"]);
  });

  it("SHA 同一: spawn 呼ばれず state 不変、kicked=false", async () => {
    const { deps, harness } = makeDeps(async () => "main-sha-1");
    const { input, getState } = makeInput({
      prs: {},
      global: { lastIndexedMainSha: "main-sha-1", lastIndexedAt: "2026-05-09T00:00:00Z" },
    });
    const result = await runIndexJob(input, deps);
    expect(result.kicked).toStrictEqual(false);
    expect(harness.spawnedFor).toStrictEqual([]);
    expect(getState().global?.lastIndexedMainSha).toStrictEqual("main-sha-1");
  });

  it("SHA が変わった: spawn + state 更新、kicked=true", async () => {
    const { deps, harness } = makeDeps(async () => "main-sha-2");
    const { input, getState } = makeInput({
      prs: {},
      global: { lastIndexedMainSha: "main-sha-1" },
    });
    const result = await runIndexJob(input, deps);
    expect(result.kicked).toStrictEqual(true);
    expect(harness.spawnedFor).toStrictEqual(["/repo"]);
    expect(getState().global?.lastIndexedMainSha).toStrictEqual("main-sha-2");
  });

  it("git fetch / rev-parse 失敗: spawn 呼ばれず state 不変、kicked=false", async () => {
    const { deps, harness } = makeDeps(async () => {
      throw new Error("git fetch timeout");
    });
    const { input, getState } = makeInput({
      prs: {},
      global: { lastIndexedMainSha: "main-sha-1" },
    });
    const result = await runIndexJob(input, deps);
    expect(result.kicked).toStrictEqual(false);
    expect(harness.spawnedFor).toStrictEqual([]);
    expect(getState().global?.lastIndexedMainSha).toStrictEqual("main-sha-1");
  });
});
