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
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  parseReviewOutput,
  runClaude,
  type ClaudeRunInput,
  type ClaudeRunResult,
} from "./claude.js";
import { hashBody } from "./dedup.js";
import { fmtDuration, log, warn } from "./log.js";
import { buildFixPrompt } from "./prompt-fix.js";
import { setPR, type State } from "./state.js";
import { createBranchWorktree, removeWorktree, type Worktree } from "./worktree.js";

const execFileP = promisify(execFile);

const CLAUDE_LOG_DIR = join(homedir(), ".cache/self-management-auto-review/logs");

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
  const tag = `[fix pr-${input.prNumber}]`;
  const jobStart = Date.now();
  log(tag, `start (branch=${input.branch}, commentId=${input.commentId}, repo=${input.repo})`);
  let wt: Worktree | null = null;
  try {
    log(tag, `creating branch worktree for ${input.branch} (with origin/main merge attempt)...`);
    const wtStart = Date.now();
    const created = await deps.createWorktree(input.repoRoot, input.prNumber, input.branch);
    wt = created.wt;
    log(
      tag,
      `worktree ready: ${wt.path} (${fmtDuration(Date.now() - wtStart)}, mergeFailed=${created.mergeFailed})`,
    );
    if (created.mergeFailed) {
      warn(tag, `origin/main merge had conflicts; AI will resolve`);
    }
    const beforeSha = await deps.revParse(wt.path, "HEAD").catch(() => "<unknown>");
    log(tag, `baseline HEAD = ${beforeSha.slice(0, 7)}`);

    const prompt = buildFixPrompt({
      prNumber: input.prNumber,
      repo: input.repo,
      branch: input.branch,
      reviewBody: input.reviewBody,
    });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const logFile = join(CLAUDE_LOG_DIR, `claude-fix-pr${input.prNumber}-${ts}.log`);
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
      return await markAddressedAndIncrement(input);
    }
    if (result.exitCode !== 0) {
      warn(
        tag,
        `claude non-zero exit ${result.exitCode}; stderr tail:\n${result.stderr.slice(-500)}\n  log=${logFile}`,
      );
    }

    const parsed = parseReviewOutput(result.stdout);
    if (parsed.fixFailedReason !== null) {
      warn(
        tag,
        `FIX_FAILED reported: ${parsed.fixFailedReason} → anti-loop bookmark; inspect: cat ${logFile}`,
      );
      return await markAddressedAndIncrement(input);
    }

    log(tag, `verifying push: comparing worktree HEAD vs origin/${input.branch}...`);
    const afterSha = await deps.revParse(wt.path, "HEAD").catch(() => "<unknown>");
    let originSha: string;
    try {
      await deps.fetchOriginBranch(wt.path, input.branch);
      originSha = await deps.revParse(wt.path, `origin/${input.branch}`);
    } catch (err) {
      warn(tag, `fetch/rev-parse origin/${input.branch} failed:`, err);
      originSha = "<unknown>";
    }
    const pushed = afterSha !== beforeSha && afterSha === originSha;
    log(
      tag,
      `push verification: before=${beforeSha.slice(0, 7)}, after=${afterSha.slice(0, 7)}, origin=${originSha.slice(0, 7)} → ${pushed ? "PUSHED" : "NOT PUSHED"}`,
    );
    if (!pushed) {
      warn(tag, `push not detected → anti-loop bookmark`);
      return await markAddressedAndIncrement(input);
    }

    const next = await input.updateState((s) => {
      const cur = s.prs[String(input.prNumber)] ?? { iterations: 0 };
      return setPR(s, input.prNumber, {
        lastAddressedCommentId: input.commentId,
        lastAddressedAt: new Date().toISOString(),
        lastAddressedBodyHash: hashBody(input.reviewBody),
        iterations: cur.iterations + 1,
      });
    });
    const itersAfter = next.prs[String(input.prNumber)]?.iterations ?? 0;
    log(tag, `state updated: lastAddressedCommentId=${input.commentId}, iterations=${itersAfter}`);
    return next;
  } catch (err) {
    warn(tag, `unexpected failure → anti-loop bookmark:`, err);
    return await markAddressedAndIncrement(input);
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
