/**
 * Reviewer mode: 1 PR の review job 実装。
 *
 * 流れ:
 *   1. read-only worktree 作成 (head_sha を detached checkout)
 *   2. claude -p に review prompt を投げる
 *   3. stdout から body / verdict を抽出
 *      - NO_OP / parse failure: 投稿せず state.lastReviewedSha + iterations を更新 (再 review skip + cap)
 *      - body + verdict あり: gh pr comment で投稿、state 更新 + iteration++
 *   4. 完了後 worktree 削除
 *
 * 副作用 (claude spawn / gh comment / git worktree) は `ReviewJobDeps` 経由で注入し、
 * test 側で fake dep を渡してロジックパスを検証できるよう構成する。
 */

import { spawn } from "node:child_process";

import {
  buildBotCommentBody,
  parseReviewOutput,
  runClaude,
  type ClaudeRunInput,
  type ClaudeRunResult,
} from "./claude.js";
import { hashBody } from "./dedup.js";
import { buildReviewPrompt } from "./prompt-review.js";
import { setPR, type State } from "./state.js";
import { createReadOnlyWorktree, removeWorktree, type Worktree } from "./worktree.js";

export interface ReviewJobInput {
  prNumber: number;
  headSha: string;
  repo: string;
  repoRoot: string;
  state: State;
  /** state を mutex 経由で書き換える updater (応答 immutable copy)。 */
  updateState: (apply: (s: State) => State) => Promise<State>;
  lastReviewBodyHash?: string;
}

export interface ReviewJobDeps {
  runClaude: (input: ClaudeRunInput) => Promise<ClaudeRunResult>;
  postPRComment: (repo: string, prNumber: number, body: string) => Promise<void>;
  createWorktree: (repoRoot: string, prNumber: number, headSha: string) => Promise<Worktree>;
  removeWorktree: (repoRoot: string, wt: Worktree) => Promise<void>;
}

/** 実 spawn を使う default deps。 */
export const DEFAULT_REVIEW_JOB_DEPS: ReviewJobDeps = {
  runClaude,
  postPRComment,
  createWorktree: createReadOnlyWorktree,
  removeWorktree,
};

/** 1 PR の review を実行し、最新 state を返す。 */
export async function runReviewJob(
  input: ReviewJobInput,
  deps: ReviewJobDeps = DEFAULT_REVIEW_JOB_DEPS,
): Promise<State> {
  const wt = await deps.createWorktree(input.repoRoot, input.prNumber, input.headSha);
  try {
    const prompt = buildReviewPrompt({
      prNumber: input.prNumber,
      repo: input.repo,
      lastReviewBodyHash: input.lastReviewBodyHash,
    });
    const result = await deps.runClaude({ prompt, cwd: wt.path });

    if (result.timedOut) {
      console.warn(`[review pr-${input.prNumber}] claude timed out`);
      // sha + iteration 更新で同 sha 再試行をブロック (anti-loop)
      return await markReviewedAndIncrement(input);
    }
    if (result.exitCode !== 0) {
      console.warn(
        `[review pr-${input.prNumber}] claude exit ${result.exitCode}; stderr tail:\n${result.stderr.slice(-500)}`,
      );
    }
    const parsed = parseReviewOutput(result.stdout);

    if (parsed.verdict === "NO_OP") {
      console.log(`[review pr-${input.prNumber}] NO_OP — body unchanged from last`);
      // NO_OP は本文同一が確認できた状態。iteration は据え置き、sha だけ更新して同 sha 再試行を防ぐ
      return await input.updateState((s) =>
        setPR(s, input.prNumber, {
          lastReviewedSha: input.headSha,
          lastReviewedAt: new Date().toISOString(),
        }),
      );
    }

    if (parsed.body === null || parsed.verdict === null) {
      console.warn(
        `[review pr-${input.prNumber}] failed to parse claude output (body=${parsed.body !== null}, verdict=${parsed.verdict})`,
      );
      // parse failure を放置すると次回 poll で同 sha を無限再試行するので、
      // sha + iteration を進めて MAX_ITERATIONS_PER_PR cap で止まるようにする
      return await markReviewedAndIncrement(input);
    }

    const fullBody = buildBotCommentBody(parsed.body, parsed.verdict);
    await deps.postPRComment(input.repo, input.prNumber, fullBody);

    return await input.updateState((s) => {
      const cur = s.prs[String(input.prNumber)] ?? { iterations: 0 };
      const nextIterations = parsed.verdict === "APPROVE" ? 0 : cur.iterations + 1;
      return setPR(s, input.prNumber, {
        lastReviewedSha: input.headSha,
        lastReviewedAt: new Date().toISOString(),
        lastReviewBodyHash: hashBody(parsed.body),
        iterations: nextIterations,
      });
    });
  } finally {
    await deps.removeWorktree(input.repoRoot, wt);
  }
}

/** sha を bookmark + iteration を 1 進める (timeout / parse failure 等の anti-loop 用)。 */
async function markReviewedAndIncrement(input: ReviewJobInput): Promise<State> {
  return await input.updateState((s) => {
    const cur = s.prs[String(input.prNumber)] ?? { iterations: 0 };
    return setPR(s, input.prNumber, {
      lastReviewedSha: input.headSha,
      lastReviewedAt: new Date().toISOString(),
      iterations: cur.iterations + 1,
    });
  });
}

/** `gh pr comment <N> --repo <R> --body-file -` に stdin で body を渡す。 */
async function postPRComment(repo: string, prNumber: number, body: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "gh",
      ["pr", "comment", String(prNumber), "--repo", repo, "--body-file", "-"],
      { stdio: ["pipe", "inherit", "inherit"] },
    );
    child.stdin.write(body);
    child.stdin.end();
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`gh pr comment exit ${code}`));
    });
  });
}
