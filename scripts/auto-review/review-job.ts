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
import { homedir } from "node:os";
import { join } from "node:path";

import {
  buildBotCommentBody,
  parseReviewOutput,
  runClaude,
  type ClaudeRunInput,
  type ClaudeRunResult,
} from "./claude.js";
import { hashBody } from "./dedup.js";
import { fmtDuration, log, warn } from "./log.js";
import { buildReviewPrompt } from "./prompt-review.js";
import { setPR, type State } from "./state.js";
import { createReadOnlyWorktree, removeWorktree, type Worktree } from "./worktree.js";

const CLAUDE_LOG_DIR = join(homedir(), ".cache/self-management-auto-review/logs");

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
  const tag = `[review pr-${input.prNumber}]`;
  const jobStart = Date.now();
  log(tag, `start (sha=${input.headSha.slice(0, 7)}, repo=${input.repo})`);
  let wt: Worktree | null = null;
  try {
    log(tag, `creating read-only worktree at sha=${input.headSha.slice(0, 7)}...`);
    const wtStart = Date.now();
    wt = await deps.createWorktree(input.repoRoot, input.prNumber, input.headSha);
    log(tag, `worktree ready: ${wt.path} (${fmtDuration(Date.now() - wtStart)})`);

    const prompt = buildReviewPrompt({
      prNumber: input.prNumber,
      repo: input.repo,
      lastReviewBodyHash: input.lastReviewBodyHash,
    });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const logFile = join(CLAUDE_LOG_DIR, `claude-review-pr${input.prNumber}-${ts}.log`);
    log(tag, `spawning claude -p (prompt=${prompt.length} chars, cwd=${wt.path}, log=${logFile})`);
    const claudeStart = Date.now();
    const result = await deps.runClaude({ prompt, cwd: wt.path, logFile });
    const claudeDur = fmtDuration(Date.now() - claudeStart);
    log(
      tag,
      `claude done (${claudeDur}, exit=${result.exitCode}, timedOut=${result.timedOut}, stdout=${result.stdout.length} chars, log=${logFile})`,
    );

    if (result.timedOut) {
      warn(tag, `claude timed out after ${claudeDur} → anti-loop bookmark (log=${logFile})`);
      return await markReviewedAndIncrement(input);
    }
    if (result.exitCode !== 0) {
      warn(
        tag,
        `claude non-zero exit ${result.exitCode}; stderr tail:\n${result.stderr.slice(-500)}\n  log=${logFile}`,
      );
    }
    const parsed = parseReviewOutput(result.stdout);

    if (parsed.verdict === "NO_OP") {
      log(tag, `NO_OP — body unchanged from last review, sha bookmark only (no post)`);
      return await input.updateState((s) =>
        setPR(s, input.prNumber, {
          lastReviewedSha: input.headSha,
          lastReviewedAt: new Date().toISOString(),
        }),
      );
    }

    if (parsed.body === null || parsed.verdict === null) {
      warn(
        tag,
        `parse failure (bodyParsed=${parsed.body !== null}, verdict=${parsed.verdict}) → anti-loop bookmark; inspect: cat ${logFile}`,
      );
      return await markReviewedAndIncrement(input);
    }

    log(
      tag,
      `parsed verdict=${parsed.verdict}, body=${parsed.body.length} chars → posting comment`,
    );
    const postStart = Date.now();
    const fullBody = buildBotCommentBody(parsed.body, parsed.verdict);
    await deps.postPRComment(input.repo, input.prNumber, fullBody);
    log(tag, `comment posted (${fmtDuration(Date.now() - postStart)})`);

    const next = await input.updateState((s) => {
      const cur = s.prs[String(input.prNumber)] ?? { iterations: 0 };
      const nextIterations = parsed.verdict === "APPROVE" ? 0 : cur.iterations + 1;
      return setPR(s, input.prNumber, {
        lastReviewedSha: input.headSha,
        lastReviewedAt: new Date().toISOString(),
        lastReviewBodyHash: hashBody(parsed.body),
        iterations: nextIterations,
      });
    });
    const itersAfter = next.prs[String(input.prNumber)]?.iterations ?? 0;
    log(
      tag,
      `state updated: lastReviewedSha=${input.headSha.slice(0, 7)}, iterations=${itersAfter}${parsed.verdict === "APPROVE" ? " (reset by APPROVE)" : ""}`,
    );
    return next;
  } catch (err) {
    warn(tag, `unexpected failure → anti-loop bookmark:`, err);
    return await markReviewedAndIncrement(input);
  } finally {
    if (wt) {
      log(tag, `removing worktree...`);
      await deps
        .removeWorktree(input.repoRoot, wt)
        .catch((e) => warn(tag, `removeWorktree error:`, e));
    }
    log(tag, `done (total ${fmtDuration(Date.now() - jobStart)})`);
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
