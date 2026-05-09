/**
 * Auto-merge job: bot の APPROVE comment + CI 全 green 条件下で `gh pr merge --squash --delete-branch`。
 *
 * 流れ:
 *   1. CI 全 check が SUCCESS かを確認 (`gh pr checks <N>` 経由)
 *   2. CI 未完了 / 失敗なら state 不変で skip (次 poll で再試行、cap 設定なし — CI が green になるまで自然に待つ)
 *   3. CI 全 pass なら `gh pr merge --squash --delete-branch`
 *   4. merge 成功 → state.lastMergedSha + lastMergedAt を bookmark
 *   5. merge 失敗 (branch protection 不足など) → state 不変で warn ログ (人間判断に委ねる)
 *
 * 副作用 (gh コマンド) は `MergeJobDeps` 経由で注入し、test 側で fake dep を差し替えてロジックパスを検証可能。
 */

import { spawn } from "node:child_process";

import { setPR, type State } from "./state.js";

export interface MergeJobInput {
  prNumber: number;
  /** merge 対象の head_sha。state.lastMergedSha のキーとして保存。 */
  headSha: string;
  repo: string;
  state: State;
  updateState: (apply: (s: State) => State) => Promise<State>;
}

export interface MergeJobDeps {
  /** `gh pr checks <N>` 等で CI 全 check が完了 + 全 SUCCESS かを返す。pending / failure ありなら false。 */
  ciAllPass: (repo: string, prNumber: number) => Promise<boolean>;
  /** `gh pr merge <N> --squash --delete-branch`。失敗は throw。 */
  mergeSquash: (repo: string, prNumber: number) => Promise<void>;
}

export const DEFAULT_MERGE_JOB_DEPS: MergeJobDeps = {
  ciAllPass,
  mergeSquash,
};

export async function runMergeJob(
  input: MergeJobInput,
  deps: MergeJobDeps = DEFAULT_MERGE_JOB_DEPS,
): Promise<{ state: State; merged: boolean }> {
  const ok = await deps.ciAllPass(input.repo, input.prNumber).catch((err: unknown) => {
    console.warn(`[merge pr-${input.prNumber}] ciAllPass error:`, err);
    return false;
  });
  if (!ok) {
    console.log(`[merge pr-${input.prNumber}] CI not all pass yet, will retry next tick`);
    return { state: input.state, merged: false };
  }
  try {
    await deps.mergeSquash(input.repo, input.prNumber);
  } catch (err) {
    console.warn(
      `[merge pr-${input.prNumber}] gh pr merge failed (branch protection or API error):`,
      err,
    );
    return { state: input.state, merged: false };
  }
  console.log(`[merge pr-${input.prNumber}] merged via squash`);
  const next = await input.updateState((s) =>
    setPR(s, input.prNumber, {
      lastMergedSha: input.headSha,
      lastMergedAt: new Date().toISOString(),
    }),
  );
  return { state: next, merged: true };
}

/** `gh pr checks <N>` を JSON で取得し、すべての check の `state` が SUCCESS / NEUTRAL / SKIPPED かを判定。 */
async function ciAllPass(repo: string, prNumber: number): Promise<boolean> {
  const stdout = await runGh([
    "pr",
    "checks",
    String(prNumber),
    "--repo",
    repo,
    "--json",
    "state,bucket,name",
  ]);
  if (!stdout.trim()) return false;
  const checks = JSON.parse(stdout) as Array<{ state: string; bucket: string; name: string }>;
  if (checks.length === 0) return false;
  // bucket: "pass" | "fail" | "pending" | "cancel" | "skipping". 全部 "pass" or "skipping" なら OK
  return checks.every((c) => c.bucket === "pass" || c.bucket === "skipping");
}

/** `gh pr merge <N> --squash --delete-branch` を実行。失敗時は exit code をエラー化。 */
async function mergeSquash(repo: string, prNumber: number): Promise<void> {
  await runGhVoid(["pr", "merge", String(prNumber), "--repo", repo, "--squash", "--delete-branch"]);
}

/** gh CLI を spawn して stdout を返す (stderr は inherit、status 非 0 で reject)。 */
function runGh(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("gh", args, { stdio: ["ignore", "pipe", "inherit"] });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`gh ${args.join(" ")} exit ${code}`));
    });
  });
}

function runGhVoid(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("gh", args, { stdio: ["ignore", "inherit", "inherit"] });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`gh ${args.join(" ")} exit ${code}`));
    });
  });
}
