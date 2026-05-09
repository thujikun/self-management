/**
 * Reviewer mode: 1 PR の review job 実装。
 *
 * 流れ:
 *   1. read-only worktree 作成 (head_sha を detached checkout)
 *   2. claude -p に review prompt を投げる
 *   3. stdout から body / verdict を抽出
 *      - NO_OP: 投稿せず state.lastReviewedSha だけ更新 (再 review 防止)
 *      - body + verdict あり: gh pr comment で投稿、state 更新 + iteration++
 *   4. 完了後 worktree 削除
 */

import { spawn } from "node:child_process";

import { buildBotCommentBody, parseReviewOutput, runClaude } from "./claude.js";
import { hashBody } from "./dedup.js";
import { buildReviewPrompt } from "./prompt-review.js";
import { setPR, type State } from "./state.js";
import { createReadOnlyWorktree, removeWorktree } from "./worktree.js";

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

/** 1 PR の review を実行し、最新 state を返す。 */
export async function runReviewJob(input: ReviewJobInput): Promise<State> {
  const wt = await createReadOnlyWorktree(input.repoRoot, input.prNumber, input.headSha);
  try {
    const prompt = buildReviewPrompt({
      prNumber: input.prNumber,
      repo: input.repo,
      lastReviewBodyHash: input.lastReviewBodyHash,
    });
    const result = await runClaude({ prompt, cwd: wt.path });
    if (result.timedOut) {
      console.warn(`[review pr-${input.prNumber}] claude timed out`);
      return input.state;
    }
    if (result.exitCode !== 0) {
      console.warn(
        `[review pr-${input.prNumber}] claude exit ${result.exitCode}; stderr tail:\n${result.stderr.slice(-500)}`,
      );
    }
    const parsed = parseReviewOutput(result.stdout);

    if (parsed.verdict === "NO_OP") {
      console.log(`[review pr-${input.prNumber}] NO_OP — body unchanged from last`);
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
      return input.state;
    }

    const fullBody = buildBotCommentBody(parsed.body, parsed.verdict);
    await postPRComment(input.repo, input.prNumber, fullBody);

    return await input.updateState((s) => {
      const cur = s.prs[String(input.prNumber)] ?? { iterations: 0 };
      const nextIterations = parsed.verdict === "APPROVE" ? 0 : cur.iterations + 1;
      return setPR(s, input.prNumber, {
        lastReviewedSha: input.headSha,
        lastReviewedAt: new Date().toISOString(),
        lastReviewBodyHash: hashBody(parsed.body!),
        iterations: nextIterations,
      });
    });
  } finally {
    await removeWorktree(input.repoRoot, wt);
  }
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
