/**
 * fix-job.ts の path 別 test。
 *
 * 検証する分岐:
 *   - timeout → commentId bookmark + iteration++ (anti-loop)
 *   - FIX_FAILED marker → 同上
 *   - push 検出失敗 (Claude crash / commit ゼロ / push エラー) → 同上
 *   - push 検出成功 → success として state 更新 + iteration++
 *   - worktree は finally で必ず削除
 */

import { describe, expect, it } from "vitest";

import type { ClaudeRunResult } from "./claude.js";
import { runFixJob, type FixJobDeps, type FixJobInput } from "./fix-job.js";
import { type State } from "./state.js";
import type { Worktree } from "./worktree.js";

interface Harness {
  worktreeOps: string[];
  fetched: string[];
  shaSequence: Map<string, string[]>;
}

function makeDeps(
  stdout: string,
  shas: { before: string; after: string; origin: string },
  opts: { exitCode?: number; timedOut?: boolean; mergeFailed?: boolean } = {},
): { deps: FixJobDeps; harness: Harness } {
  const harness: Harness = { worktreeOps: [], fetched: [], shaSequence: new Map() };
  const fakeWorktree: Worktree = { path: "/tmp/fake-fix-wt", prNumber: 0 };
  // revParse の連続呼び出しに対する response (HEAD は before → after の 2 回呼ばれる)
  const headResponses = [shas.before, shas.after];
  let headIdx = 0;
  const deps: FixJobDeps = {
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

function makeInput(
  state: State,
  commentId = 12345,
): {
  input: FixJobInput;
  getState: () => State;
} {
  let current = state;
  const input: FixJobInput = {
    prNumber: 9,
    repo: "thujikun/self-management",
    repoRoot: "/repo",
    branch: "feat/sample",
    reviewBody: "(review body verbatim)",
    commentId,
    state: current,
    updateState: async (updater) => {
      current = updater(current);
      return current;
    },
  };
  return { input, getState: () => current };
}

describe("runFixJob", () => {
  it("timeout: commentId bookmark + iteration++、push 検証 skip", async () => {
    const { deps, harness } = makeDeps(
      "",
      { before: "AAA", after: "AAA", origin: "AAA" },
      { timedOut: true },
    );
    const { input, getState } = makeInput({ prs: { "9": { iterations: 1 } } });
    await runFixJob(input, deps);
    const after = getState().prs["9"];
    expect(after?.lastAddressedCommentId).toStrictEqual(12345);
    expect(after?.iterations).toStrictEqual(2);
    expect(harness.fetched).toStrictEqual([]);
    expect(harness.worktreeOps).toStrictEqual(["create-9", "remove-9"]);
  });

  it("FIX_FAILED: commentId bookmark + iteration++、push 検証 skip", async () => {
    const { deps, harness } = makeDeps("<!-- FIX_FAILED:conflict 解消できず -->\n", {
      before: "AAA",
      after: "AAA",
      origin: "AAA",
    });
    const { input, getState } = makeInput({ prs: {} });
    await runFixJob(input, deps);
    const after = getState().prs["9"];
    expect(after?.lastAddressedCommentId).toStrictEqual(12345);
    expect(after?.iterations).toStrictEqual(1);
    expect(harness.fetched).toStrictEqual([]);
  });

  it("push 検出失敗 (HEAD 不変): success にせず anti-loop", async () => {
    const { deps, harness } = makeDeps("", {
      before: "AAA",
      after: "AAA", // Claude が commit しなかった
      origin: "AAA",
    });
    const { input, getState } = makeInput({ prs: { "9": { iterations: 0 } } });
    await runFixJob(input, deps);
    const after = getState().prs["9"];
    expect(after?.lastAddressedCommentId).toStrictEqual(12345);
    expect(after?.iterations).toStrictEqual(1);
    // bodyHash は付与されない (success path に入っていないため)
    expect(after?.lastAddressedBodyHash).toStrictEqual(undefined);
    expect(harness.fetched).toStrictEqual(["feat/sample"]);
  });

  it("push 検出失敗 (HEAD は動いたが origin に未反映): 同上", async () => {
    const { deps } = makeDeps("", {
      before: "AAA",
      after: "BBB", // local commit はあった
      origin: "AAA", // origin には push されてない
    });
    const { input, getState } = makeInput({ prs: {} });
    await runFixJob(input, deps);
    const after = getState().prs["9"];
    expect(after?.iterations).toStrictEqual(1);
    expect(after?.lastAddressedBodyHash).toStrictEqual(undefined);
  });

  it("push 検出成功 (HEAD 移動 + origin 一致): bookmark + bodyHash + iteration++", async () => {
    const { deps, harness } = makeDeps("", {
      before: "AAA",
      after: "BBB",
      origin: "BBB", // push 済
    });
    const { input, getState } = makeInput({ prs: { "9": { iterations: 2 } } });
    await runFixJob(input, deps);
    const after = getState().prs["9"];
    expect(after?.lastAddressedCommentId).toStrictEqual(12345);
    expect(after?.iterations).toStrictEqual(3);
    expect(after?.lastAddressedBodyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(after?.lastAddressedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(harness.fetched).toStrictEqual(["feat/sample"]);
  });

  it("worktree は finally で削除 (Claude crash でも)", async () => {
    const { deps, harness } = makeDeps("", { before: "AAA", after: "AAA", origin: "AAA" });
    const failingDeps: FixJobDeps = {
      ...deps,
      runClaude: async () => {
        throw new Error("spawn failed");
      },
    };
    const { input } = makeInput({ prs: {} });
    await expect(runFixJob(input, failingDeps)).rejects.toThrow("spawn failed");
    expect(harness.worktreeOps).toStrictEqual(["create-9", "remove-9"]);
  });
});
