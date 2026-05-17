/**
 * Update-branch mode: PR が base に対して BEHIND (= conflict なしで遅れているだけ) のときに
 * `gh pr update-branch` を直接叩いて base ref を branch に取り込む job 実装。
 *
 * 流れ:
 *   1. `gh pr update-branch <N>` を実行
 *   2. 成功: `lastUpdateBranchedSha` / `lastUpdateBranchedAt` を bookmark
 *      → 新 commit が PR head に push されるので、次 tick で reviewer が新 SHA を見て再評価する
 *   3. 失敗 (gh CLI exit !=0 / throw): `updateBranchFailureCount` + `lastUpdateBranchFailedAt` を更新。
 *      poll 側で backoff 窓 + failure cap を確認した上で同 SHA の retry を一定 cap まで許可する
 *
 * 旧来は merge-job が merge 失敗 → "head out of date" を検知してから update-branch を呼んでいたため、
 * APPROVE + CI green まで待たないと branch が更新されなかった。本 job は **CI / review verdict と無関係**
 * に BEHIND PR を proactively 更新するので、review → fix の round-trip 中も並行して branch を rebase 同等に
 * 保てる (= speed up)。
 *
 * 副作用 (gh CLI 呼び出し) は `UpdateBranchJobDeps` で注入し、test 側で fake dep を差し替え可能。
 * worktree も AI 起動も無いので job 自体は ~1-3s (gh 呼び出し 1 回) で終わる軽量 job。
 */

import { spawn } from "node:child_process";

import { fmtDuration, log, warn } from "./log.js";
import { setPR, type PRState, type State } from "./state.js";

export interface UpdateBranchJobInput {
  prNumber: number;
  /** update-branch を試みる前の head_sha。state.lastUpdateBranchedSha / lastFailedUpdateBranchSha のキー。 */
  headSha: string;
  repo: string;
  state: State;
  updateState: (apply: (s: State) => State) => Promise<State>;
}

export interface UpdateBranchJobDeps {
  /** `gh pr update-branch <N>` で PR branch に base を取り込んで up-to-date 化。失敗は throw。 */
  updateBranch: (repo: string, prNumber: number) => Promise<void>;
}

export const DEFAULT_UPDATE_BRANCH_JOB_DEPS: UpdateBranchJobDeps = {
  updateBranch,
};

export async function runUpdateBranchJob(
  input: UpdateBranchJobInput,
  deps: UpdateBranchJobDeps = DEFAULT_UPDATE_BRANCH_JOB_DEPS,
): Promise<{ state: State; updated: boolean }> {
  const tag = `[update-branch pr-${input.prNumber}]`;
  const jobStart = Date.now();
  log(tag, `start (sha=${input.headSha.slice(0, 7)}, repo=${input.repo})`);
  try {
    await deps.updateBranch(input.repo, input.prNumber);
  } catch (err) {
    warn(tag, `gh pr update-branch failed (may retry next tick):`, err);
    const next = await input.updateState((s) => {
      const cur = s.prs[String(input.prNumber)] ?? { iterations: 0 };
      const sameSha = cur.lastFailedUpdateBranchSha === input.headSha;
      const nextCount = sameSha ? (cur.updateBranchFailureCount ?? 0) + 1 : 1;
      const partial: Partial<PRState> = {
        updateBranchFailureCount: nextCount,
        lastFailedUpdateBranchSha: input.headSha,
        lastUpdateBranchFailedAt: new Date().toISOString(),
      };
      return setPR(s, input.prNumber, partial);
    });
    log(tag, `done — not updated (total ${fmtDuration(Date.now() - jobStart)})`);
    return { state: next, updated: false };
  }
  const next = await input.updateState((s) =>
    setPR(s, input.prNumber, {
      lastUpdateBranchedSha: input.headSha,
      lastUpdateBranchedAt: new Date().toISOString(),
      ...UPDATE_BRANCH_FAILURE_CLEAR,
    }),
  );
  log(
    tag,
    `update-branch succeeded; new SHA will appear on next poll tick (total ${fmtDuration(Date.now() - jobStart)})`,
  );
  return { state: next, updated: true };
}

/**
 * 成功 path で渡す partial。failure 系 fields を `undefined` で上書きクリアして state.json を clean に保つ。
 */
const UPDATE_BRANCH_FAILURE_CLEAR: Pick<
  PRState,
  "updateBranchFailureCount" | "lastFailedUpdateBranchSha" | "lastUpdateBranchFailedAt"
> = {
  updateBranchFailureCount: undefined,
  lastFailedUpdateBranchSha: undefined,
  lastUpdateBranchFailedAt: undefined,
};

/** `gh pr update-branch <N>` で PR branch に base を取り込み up-to-date 化 (default: merge)。 */
async function updateBranch(repo: string, prNumber: number): Promise<void> {
  await runGhCapture(["pr", "update-branch", String(prNumber), "--repo", repo]);
}

/**
 * gh CLI を spawn し stdout / stderr を両方 capture。
 * 失敗時 (exit !=0) は Error.message に stderr を含めて投げる。エラー文言で原因判別する呼び出し側のため。
 */
function runGhCapture(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("gh", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const tail = (stderr.trim() || stdout.trim()).slice(-500);
        reject(new Error(`gh ${args.join(" ")} exit ${code}\n${tail}`));
      }
    });
  });
}
