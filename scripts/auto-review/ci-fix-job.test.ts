/**
 * ci-fix-job.ts の path 別 test。fix-job.test.ts と並列の構造 (key が head_sha)。
 *
 * 検証する分岐:
 *   - timeout → 失敗記録 (ciFixFailureCount, lastFailedCiFixSha, lastCiFixFailedAt)、SHA bookmark しない
 *   - exit !=0 (runtime failure) → parse 試行せず record、push 検証 skip
 *   - FIX_FAILED marker → 失敗記録
 *   - push 検出失敗 → 失敗記録
 *   - push 検出成功 → SHA bookmark + iteration++
 *   - 同 SHA で連続失敗 → ciFixFailureCount 積み上がる
 *   - 失敗 SHA が変わる → 1 から再カウント
 *   - 成功時に failure 系 fields がクリア
 *   - worktree は finally で必ず削除
 */

import { describe, expect, it } from "vitest";

import type { ClaudeRunResult } from "./claude.js";
import {
  runCiFixJob,
  type CiFixJobDeps,
  type CiFixJobInput,
  type FailingCheck,
} from "./ci-fix-job.js";
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
): { deps: CiFixJobDeps; harness: Harness } {
  const harness: Harness = { worktreeOps: [], fetched: [] };
  const fakeWorktree: Worktree = { path: "/tmp/fake-ci-fix-wt", prNumber: 0 };
  const headResponses = [shas.before, shas.after];
  let headIdx = 0;
  const deps: CiFixJobDeps = {
    runClaude: async (): Promise<ClaudeRunResult> => ({
      stdout,
      stderr: "",
      exitCode: opts.exitCode ?? 0,
      timedOut: opts.timedOut ?? false,
    }),
    createWorktree: async (_repoRoot, prNumber, _branch) => {
      harness.worktreeOps.push(`create-${prNumber}`);
      return { wt: { ...fakeWorktree, prNumber }, mergeFailed: opts.mergeFailed ?? false };
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

const FAILING_CHECKS: FailingCheck[] = [
  {
    name: "Pulumi core",
    runId: "111",
    jobUrl: "https://github.com/owner/repo/actions/runs/111/job/222",
  },
];

function makeInput(
  state: State,
  headSha = "abc123",
): {
  input: CiFixJobInput;
  getState: () => State;
} {
  let current = state;
  const input: CiFixJobInput = {
    prNumber: 28,
    headSha,
    repo: "thujikun/self-management",
    repoRoot: "/repo",
    branch: "feat/sample",
    failingChecks: FAILING_CHECKS,
    state: current,
    updateState: async (updater) => {
      current = updater(current);
      return current;
    },
  };
  return { input, getState: () => current };
}

describe("runCiFixJob", () => {
  it("timeout: 失敗記録のみ (SHA bookmark せず、iteration 据え置き)、push 検証 skip", async () => {
    const { deps, harness } = makeDeps(
      "",
      { before: "AAA", after: "AAA", origin: "AAA" },
      { timedOut: true },
    );
    const { input, getState } = makeInput({ prs: { "28": { iterations: 1 } } });
    await runCiFixJob(input, deps);
    const after = getState().prs["28"];
    expect(after?.lastCiFixedSha).toStrictEqual(undefined);
    expect(after?.iterations).toStrictEqual(1);
    expect(after?.ciFixFailureCount).toStrictEqual(1);
    expect(after?.lastFailedCiFixSha).toStrictEqual("abc123");
    expect(after?.lastCiFixFailedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(harness.fetched).toStrictEqual([]);
    expect(harness.worktreeOps).toStrictEqual(["create-28", "remove-28"]);
  });

  it("exit !=0 (runtime failure): parse 試行せず record、push 検証 skip", async () => {
    const { deps, harness } = makeDeps(
      "Invalid API key · Fix external API key",
      { before: "AAA", after: "AAA", origin: "AAA" },
      { exitCode: 1 },
    );
    const { input, getState } = makeInput({ prs: { "28": { iterations: 2 } } });
    await runCiFixJob(input, deps);
    const after = getState().prs["28"];
    expect(after?.lastCiFixedSha).toStrictEqual(undefined);
    expect(after?.iterations).toStrictEqual(2);
    expect(after?.ciFixFailureCount).toStrictEqual(1);
    expect(after?.lastFailedCiFixSha).toStrictEqual("abc123");
    expect(harness.fetched).toStrictEqual([]);
  });

  it("FIX_FAILED: 失敗記録のみ、push 検証 skip", async () => {
    const { deps, harness } = makeDeps(
      "<!-- FIX_FAILED:passphrase secret 不在で diag できず -->\n",
      {
        before: "AAA",
        after: "AAA",
        origin: "AAA",
      },
    );
    const { input, getState } = makeInput({ prs: {} });
    await runCiFixJob(input, deps);
    const after = getState().prs["28"];
    expect(after?.lastCiFixedSha).toStrictEqual(undefined);
    expect(after?.ciFixFailureCount).toStrictEqual(1);
    expect(after?.lastFailedCiFixSha).toStrictEqual("abc123");
    expect(harness.fetched).toStrictEqual([]);
  });

  it("push 検出失敗 (HEAD 不変): 失敗記録", async () => {
    const { deps, harness } = makeDeps("", {
      before: "AAA",
      after: "AAA",
      origin: "AAA",
    });
    const { input, getState } = makeInput({ prs: { "28": { iterations: 0 } } });
    await runCiFixJob(input, deps);
    const after = getState().prs["28"];
    expect(after?.lastCiFixedSha).toStrictEqual(undefined);
    expect(after?.ciFixFailureCount).toStrictEqual(1);
    expect(harness.fetched).toStrictEqual(["feat/sample"]);
  });

  it("push 検出失敗 (HEAD は動いたが origin 未反映): 失敗記録", async () => {
    const { deps } = makeDeps("", {
      before: "AAA",
      after: "BBB",
      origin: "AAA",
    });
    const { input, getState } = makeInput({ prs: {} });
    await runCiFixJob(input, deps);
    expect(getState().prs["28"]?.ciFixFailureCount).toStrictEqual(1);
    expect(getState().prs["28"]?.lastCiFixedSha).toStrictEqual(undefined);
  });

  it("push 検出成功: SHA bookmark + iteration++", async () => {
    const { deps, harness } = makeDeps("", {
      before: "AAA",
      after: "BBB",
      origin: "BBB",
    });
    const { input, getState } = makeInput({ prs: { "28": { iterations: 2 } } });
    await runCiFixJob(input, deps);
    const after = getState().prs["28"];
    expect(after?.lastCiFixedSha).toStrictEqual("abc123");
    expect(after?.iterations).toStrictEqual(3);
    expect(after?.lastCiFixedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(harness.fetched).toStrictEqual(["feat/sample"]);
  });

  it("同 SHA で連続失敗: ciFixFailureCount が積み上がる", async () => {
    const { deps } = makeDeps("<!-- FIX_FAILED:still bad -->\n", {
      before: "AAA",
      after: "AAA",
      origin: "AAA",
    });
    const { input, getState } = makeInput({
      prs: {
        "28": {
          iterations: 0,
          ciFixFailureCount: 2,
          lastFailedCiFixSha: "abc123",
          lastCiFixFailedAt: "2026-05-10T00:00:00.000Z",
        },
      },
    });
    await runCiFixJob(input, deps);
    expect(getState().prs["28"]?.ciFixFailureCount).toStrictEqual(3);
    expect(getState().prs["28"]?.lastFailedCiFixSha).toStrictEqual("abc123");
  });

  it("失敗 SHA が変わる: ciFixFailureCount が 1 から再カウント", async () => {
    const { deps } = makeDeps("<!-- FIX_FAILED:other -->\n", {
      before: "AAA",
      after: "AAA",
      origin: "AAA",
    });
    const { input, getState } = makeInput(
      {
        prs: {
          "28": {
            iterations: 0,
            ciFixFailureCount: 5,
            lastFailedCiFixSha: "old_sha",
            lastCiFixFailedAt: "2026-05-10T00:00:00.000Z",
          },
        },
      },
      "new_sha",
    );
    await runCiFixJob(input, deps);
    expect(getState().prs["28"]?.ciFixFailureCount).toStrictEqual(1);
    expect(getState().prs["28"]?.lastFailedCiFixSha).toStrictEqual("new_sha");
  });

  it("失敗 → 成功 (push 検出) で failure 系 fields がクリア", async () => {
    const { deps } = makeDeps("", { before: "AAA", after: "BBB", origin: "BBB" });
    const { input, getState } = makeInput({
      prs: {
        "28": {
          iterations: 0,
          ciFixFailureCount: 2,
          lastFailedCiFixSha: "abc123",
          lastCiFixFailedAt: "2026-05-10T00:00:00.000Z",
        },
      },
    });
    await runCiFixJob(input, deps);
    const after = getState().prs["28"];
    expect(after?.lastCiFixedSha).toStrictEqual("abc123");
    expect(after?.ciFixFailureCount).toStrictEqual(undefined);
    expect(after?.lastFailedCiFixSha).toStrictEqual(undefined);
    expect(after?.lastCiFixFailedAt).toStrictEqual(undefined);
  });

  it("Claude spawn が throw: 失敗記録、worktree は finally 削除", async () => {
    const { deps, harness } = makeDeps("", { before: "AAA", after: "AAA", origin: "AAA" });
    const failingDeps: CiFixJobDeps = {
      ...deps,
      runClaude: async () => {
        throw new Error("spawn failed");
      },
    };
    const { input, getState } = makeInput({ prs: { "28": { iterations: 0 } } });
    await runCiFixJob(input, failingDeps);
    expect(harness.worktreeOps).toStrictEqual(["create-28", "remove-28"]);
    const after = getState().prs["28"];
    expect(after?.lastCiFixedSha).toStrictEqual(undefined);
    expect(after?.iterations).toStrictEqual(0);
    expect(after?.ciFixFailureCount).toStrictEqual(1);
  });

  it("createWorktree が throw: 失敗記録、worktree 削除呼び出し無し", async () => {
    const { deps, harness } = makeDeps("", { before: "AAA", after: "AAA", origin: "AAA" });
    const failingDeps: CiFixJobDeps = {
      ...deps,
      createWorktree: async () => {
        throw new Error("fatal: branch already in use");
      },
    };
    const { input, getState } = makeInput({ prs: { "28": { iterations: 0 } } });
    await runCiFixJob(input, failingDeps);
    expect(harness.worktreeOps).toStrictEqual([]);
    const after = getState().prs["28"];
    expect(after?.lastCiFixedSha).toStrictEqual(undefined);
    expect(after?.iterations).toStrictEqual(0);
    expect(after?.ciFixFailureCount).toStrictEqual(1);
  });
});
