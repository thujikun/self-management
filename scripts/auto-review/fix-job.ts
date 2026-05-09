/**
 * Author mode: 1 PR の fix job 実装。
 *
 * 流れ:
 *   1. PR branch worktree 作成 (origin/main を merge 試行、conflict 残存可)
 *   2. claude -p に fix prompt + reviewBody を投げる (Claude 自身が conflict 解消 → 修正 → 6 gate → commit & push)
 *   3. stdout に FIX_FAILED が含まれていたら iteration を進めず skip
 *   4. 成功 (push 完了) なら state.lastAddressedCommentId / iterations++ を更新
 */

import { hashBody } from "./dedup.js";
import { parseReviewOutput, runClaude } from "./claude.js";
import { buildFixPrompt } from "./prompt-fix.js";
import { setPR, type State } from "./state.js";
import { createBranchWorktree, removeWorktree } from "./worktree.js";

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

export async function runFixJob(input: FixJobInput): Promise<State> {
  const { wt, mergeFailed } = await createBranchWorktree(
    input.repoRoot,
    input.prNumber,
    input.branch,
  );
  if (mergeFailed) {
    console.warn(`[fix pr-${input.prNumber}] origin/main merge had conflicts; AI will resolve`);
  }
  try {
    const prompt = buildFixPrompt({
      prNumber: input.prNumber,
      repo: input.repo,
      branch: input.branch,
      reviewBody: input.reviewBody,
    });
    const result = await runClaude({ prompt, cwd: wt.path });

    if (result.timedOut) {
      console.warn(`[fix pr-${input.prNumber}] claude timed out`);
      return input.state;
    }
    if (result.exitCode !== 0) {
      console.warn(
        `[fix pr-${input.prNumber}] claude exit ${result.exitCode}; stderr tail:\n${result.stderr.slice(-500)}`,
      );
    }

    const parsed = parseReviewOutput(result.stdout);
    if (parsed.fixFailedReason !== null) {
      console.warn(`[fix pr-${input.prNumber}] FIX_FAILED: ${parsed.fixFailedReason}`);
      // iteration 進めず skip。次回の poll で commentId が同じなら再 enqueue されない (state 未更新で同 id を引き続き skip)
      return input.state;
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
  } finally {
    await removeWorktree(input.repoRoot, wt);
  }
}
