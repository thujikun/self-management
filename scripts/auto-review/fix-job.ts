/**
 * Author mode: 1 PR の fix job 実装。
 *
 * 流れ:
 *   1. PR branch worktree 作成 (origin/main を merge 試行、conflict 残存可)
 *   2. claude -p に fix prompt + reviewBody を投げる (Claude 自身が conflict 解消 → 修正 → 6 gate → commit & push)
 *   3. push 検証: worktree HEAD と origin/<branch> の SHA を比較し、本当に push されたか確認
 *      - FIX_FAILED marker / push 検出失敗 / Claude crash の何れも commentId を bookmark + iteration を進めて
 *        anti-loop cap で止まるようにする (state 不変で永久 retry させない)
 *      - push 検出成功なら success として bookmark + iteration を進める
 *   4. 完了後 worktree 削除
 *
 * 副作用 (claude spawn / git worktree / git rev-parse / fetch) は `FixJobDeps` 経由で注入し、
 * test 側で fake dep を渡してロジックパスを検証できるよう構成する。
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  parseReviewOutput,
  runClaude,
  type ClaudeRunInput,
  type ClaudeRunResult,
} from "./claude.js";
import { hashBody } from "./dedup.js";
import { buildFixPrompt } from "./prompt-fix.js";
import { setPR, type State } from "./state.js";
import { createBranchWorktree, removeWorktree, type Worktree } from "./worktree.js";

const execFileP = promisify(execFile);

export interface FixJobInput {
  prNumber: number;
  repo: string;
  repoRoot: string;
  branch: string;
  /** 受け取ったレビューの body 全文 (auto-review marker 付き)。 */
  reviewBody: string;
  /** GitHub comment ID。state.lastAddressedCommentId に保存。 */
  commentId: number;
  state: State;
  updateState: (apply: (s: State) => State) => Promise<State>;
}

export interface FixJobDeps {
  runClaude: (input: ClaudeRunInput) => Promise<ClaudeRunResult>;
  createWorktree: (
    repoRoot: string,
    prNumber: number,
    branch: string,
  ) => Promise<{ wt: Worktree; mergeFailed: boolean }>;
  removeWorktree: (repoRoot: string, wt: Worktree) => Promise<void>;
  /** 当該 worktree で `git rev-parse <ref>` を返す (test 用に注入可能)。 */
  revParse: (worktreePath: string, ref: string) => Promise<string>;
  /** `git fetch origin <branch>` を当該 worktree で実行 (test 用に注入可能)。 */
  fetchOriginBranch: (worktreePath: string, branch: string) => Promise<void>;
}

export const DEFAULT_FIX_JOB_DEPS: FixJobDeps = {
  runClaude,
  createWorktree: createBranchWorktree,
  removeWorktree,
  revParse,
  fetchOriginBranch,
};

export async function runFixJob(
  input: FixJobInput,
  deps: FixJobDeps = DEFAULT_FIX_JOB_DEPS,
): Promise<State> {
  let wt: Worktree | null = null;
  try {
    const created = await deps.createWorktree(input.repoRoot, input.prNumber, input.branch);
    wt = created.wt;
    if (created.mergeFailed) {
      console.warn(`[fix pr-${input.prNumber}] origin/main merge had conflicts; AI will resolve`);
    }
    // worktree 作成直後 (= origin/<branch> + origin/main merge 後) の HEAD を baseline とする。
    // Claude が commit + push したら HEAD と origin/<branch> がともに move する。
    const beforeSha = await deps.revParse(wt.path, "HEAD").catch(() => "<unknown>");

    const prompt = buildFixPrompt({
      prNumber: input.prNumber,
      repo: input.repo,
      branch: input.branch,
      reviewBody: input.reviewBody,
    });
    const result = await deps.runClaude({ prompt, cwd: wt.path });

    if (result.timedOut) {
      console.warn(`[fix pr-${input.prNumber}] claude timed out`);
      return await markAddressedAndIncrement(input);
    }
    if (result.exitCode !== 0) {
      console.warn(
        `[fix pr-${input.prNumber}] claude exit ${result.exitCode}; stderr tail:\n${result.stderr.slice(-500)}`,
      );
    }

    const parsed = parseReviewOutput(result.stdout);
    if (parsed.fixFailedReason !== null) {
      console.warn(`[fix pr-${input.prNumber}] FIX_FAILED: ${parsed.fixFailedReason}`);
      // commentId を bookmark + iteration を進めて、同 commentId の永久 retry を遮断する
      // (再試行が必要なら state.json を手動編集して該当 PR の lastAddressedCommentId を消す)
      return await markAddressedAndIncrement(input);
    }

    // push 検証: worktree HEAD が beforeSha から動いていて、かつ origin/<branch> が一致するなら本当に push された
    const afterSha = await deps.revParse(wt.path, "HEAD").catch(() => "<unknown>");
    let originSha: string;
    try {
      await deps.fetchOriginBranch(wt.path, input.branch);
      originSha = await deps.revParse(wt.path, `origin/${input.branch}`);
    } catch (err) {
      console.warn(
        `[fix pr-${input.prNumber}] fetch/rev-parse origin/${input.branch} failed:`,
        err,
      );
      originSha = "<unknown>";
    }
    const pushed = afterSha !== beforeSha && afterSha === originSha;
    if (!pushed) {
      console.warn(
        `[fix pr-${input.prNumber}] push not detected (before=${beforeSha}, after=${afterSha}, origin=${originSha})`,
      );
      // Claude が crash / commit ゼロ / push 失敗の何れの場合も、anti-loop で止めるために commentId と iteration を進める
      return await markAddressedAndIncrement(input);
    }

    return await input.updateState((s) => {
      const cur = s.prs[String(input.prNumber)] ?? { iterations: 0 };
      return setPR(s, input.prNumber, {
        lastAddressedCommentId: input.commentId,
        lastAddressedAt: new Date().toISOString(),
        lastAddressedBodyHash: hashBody(input.reviewBody),
        iterations: cur.iterations + 1,
      });
    });
  } catch (err) {
    // worktree creation 失敗 (例: Ryan が main repo で当該 branch を checkout 中) や
    // 他の予期せぬ throw を anti-loop に倒す。state を進めないと poll loop が同 commentId を永久 retry する。
    console.warn(`[fix pr-${input.prNumber}] failed:`, err);
    return await markAddressedAndIncrement(input);
  } finally {
    if (wt) {
      await deps
        .removeWorktree(input.repoRoot, wt)
        .catch((e) => console.warn(`[fix pr-${input.prNumber}] removeWorktree error:`, e));
    }
  }
}

/** commentId を bookmark + iteration を 1 進める (FIX_FAILED / timeout / push 失敗等の anti-loop 用)。 */
async function markAddressedAndIncrement(input: FixJobInput): Promise<State> {
  return await input.updateState((s) => {
    const cur = s.prs[String(input.prNumber)] ?? { iterations: 0 };
    return setPR(s, input.prNumber, {
      lastAddressedCommentId: input.commentId,
      lastAddressedAt: new Date().toISOString(),
      iterations: cur.iterations + 1,
    });
  });
}

async function revParse(worktreePath: string, ref: string): Promise<string> {
  const { stdout } = await execFileP("git", ["-C", worktreePath, "rev-parse", ref], {
    timeout: 30_000,
  });
  return stdout.trim();
}

async function fetchOriginBranch(worktreePath: string, branch: string): Promise<void> {
  await execFileP("git", ["-C", worktreePath, "fetch", "origin", branch], { timeout: 60_000 });
}
