/**
 * CI-fix mode: bot の APPROVE 後に CI が failing な PR を bot 自身で修正する job 実装。
 *
 * 流れ:
 *   1. PR branch worktree 作成 (origin/main を merge 試行、conflict 残存可)
 *   2. claude -p に ci-fix prompt (失敗 check 一覧) を投げる
 *      Claude 自身が `gh run view --log-failed` で詳細を fetch → 診断 → 修正 → 6 gate → commit & push
 *   3. push 検証: worktree HEAD と origin/<branch> の SHA を比較し、本当に push されたか確認
 *      - 成功 (push 検出): `lastCiFixedSha` を bookmark + `iterations++` (round-trip cap 用)
 *      - 失敗 (FIX_FAILED / push 検出失敗 / timeout / throw): SHA は bookmark **しない**。代わりに
 *        per-SHA の `ciFixFailureCount` + `lastCiFixFailedAt` を更新する。poll 側で backoff 窓 +
 *        failure cap を確認した上で、同 SHA の retry を一定 cap まで許可する
 *   4. 完了後 worktree 削除
 *
 * 副作用 (claude spawn / git worktree / git rev-parse / fetch) は `CiFixJobDeps` で注入可能。
 * fix-job.ts と並列の構造 (key が commentId ではなく head_sha である点が違う)。
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
import { fmtDuration, log, warn } from "./log.js";
import { buildCiFixPrompt } from "./prompt-ci-fix.js";
import { setPR, type PRState, type State } from "./state.js";
import { createBranchWorktree, removeWorktree, type Worktree } from "./worktree.js";

const execFileP = promisify(execFile);

const CLAUDE_LOG_DIR = join(homedir(), ".cache/self-management-auto-review/logs");

export interface FailingCheck {
  name: string;
  runId: string;
  jobUrl: string;
}

export interface CiFixJobInput {
  prNumber: number;
  /** 対象 head_sha。state.lastCiFixedSha / lastFailedCiFixSha のキー。 */
  headSha: string;
  repo: string;
  repoRoot: string;
  branch: string;
  /** poll で取得した failing checks 一覧 (空なら呼び出し側のミス、ここで guard はしない)。 */
  failingChecks: ReadonlyArray<FailingCheck>;
  state: State;
  updateState: (apply: (s: State) => State) => Promise<State>;
}

export interface CiFixJobDeps {
  runClaude: (input: ClaudeRunInput) => Promise<ClaudeRunResult>;
  createWorktree: (
    repoRoot: string,
    prNumber: number,
    branch: string,
  ) => Promise<{ wt: Worktree; mergeFailed: boolean }>;
  removeWorktree: (repoRoot: string, wt: Worktree) => Promise<void>;
  revParse: (worktreePath: string, ref: string) => Promise<string>;
  fetchOriginBranch: (worktreePath: string, branch: string) => Promise<void>;
}

export const DEFAULT_CI_FIX_JOB_DEPS: CiFixJobDeps = {
  runClaude,
  createWorktree: createBranchWorktree,
  removeWorktree,
  revParse,
  fetchOriginBranch,
};

export async function runCiFixJob(
  input: CiFixJobInput,
  deps: CiFixJobDeps = DEFAULT_CI_FIX_JOB_DEPS,
): Promise<State> {
  const tag = `[ci-fix pr-${input.prNumber}]`;
  const jobStart = Date.now();
  log(
    tag,
    `start (sha=${input.headSha.slice(0, 7)}, branch=${input.branch}, failing=${input.failingChecks.length} check(s))`,
  );
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

    const prompt = buildCiFixPrompt({
      prNumber: input.prNumber,
      repo: input.repo,
      branch: input.branch,
      failingChecks: input.failingChecks,
    });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const logFile = join(CLAUDE_LOG_DIR, `claude-ci-fix-pr${input.prNumber}-${ts}.log`);
    log(tag, `spawning claude -p (prompt=${prompt.length} chars, cwd=${wt.path}, log=${logFile})`);
    const claudeStart = Date.now();
    const result = await deps.runClaude({ prompt, cwd: wt.path, logFile });
    const claudeDur = fmtDuration(Date.now() - claudeStart);
    log(
      tag,
      `claude done (${claudeDur}, exit=${result.exitCode}, timedOut=${result.timedOut}, stdout=${result.stdout.length} chars, log=${logFile})`,
    );

    if (result.timedOut) {
      warn(
        tag,
        `claude timed out after ${claudeDur} → record failure (will retry after backoff). log=${logFile}`,
      );
      return await recordCiFixFailure(input);
    }
    if (result.exitCode !== 0) {
      const tail = (result.stderr.trim() || result.stdout.trim()).slice(-500);
      warn(
        tag,
        `claude non-zero exit ${result.exitCode} (runtime failure, not a parse issue) → record failure (will retry after backoff); tail:\n${tail}\n  log=${logFile}`,
      );
      return await recordCiFixFailure(input);
    }

    const parsed = parseReviewOutput(result.stdout);
    if (parsed.fixFailedReason !== null) {
      warn(
        tag,
        `FIX_FAILED reported: ${parsed.fixFailedReason} → record failure (will retry after backoff); inspect: cat ${logFile}`,
      );
      return await recordCiFixFailure(input);
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
      warn(tag, `push not detected → record failure (will retry after backoff)`);
      return await recordCiFixFailure(input);
    }

    const next = await input.updateState((s) => {
      const cur = s.prs[String(input.prNumber)] ?? { iterations: 0 };
      return setPR(s, input.prNumber, {
        lastCiFixedSha: input.headSha,
        lastCiFixedAt: new Date().toISOString(),
        iterations: cur.iterations + 1,
        ...CI_FIX_FAILURE_CLEAR,
      });
    });
    const itersAfter = next.prs[String(input.prNumber)]?.iterations ?? 0;
    log(
      tag,
      `state updated: lastCiFixedSha=${input.headSha.slice(0, 7)}, iterations=${itersAfter}`,
    );
    return next;
  } catch (err) {
    warn(tag, `unexpected failure → record failure (will retry after backoff):`, err);
    return await recordCiFixFailure(input);
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

/**
 * 成功 path で渡す partial。failure 系 fields を `undefined` で上書きクリアして state.json を clean に保つ。
 */
const CI_FIX_FAILURE_CLEAR: Pick<
  PRState,
  "ciFixFailureCount" | "lastFailedCiFixSha" | "lastCiFixFailedAt"
> = {
  ciFixFailureCount: undefined,
  lastFailedCiFixSha: undefined,
  lastCiFixFailedAt: undefined,
};

/**
 * 失敗を記録するが SHA は bookmark しない (FIX_FAILED / timeout / push 失敗 / throw 等)。
 * 同 SHA に対する失敗なら count++、SHA が変わっていれば 1 から再カウント。
 * `iterations` は触らない (round-trip cap を失敗で消費しない)。
 */
async function recordCiFixFailure(input: CiFixJobInput): Promise<State> {
  return await input.updateState((s) => {
    const cur = s.prs[String(input.prNumber)] ?? { iterations: 0 };
    const sameSha = cur.lastFailedCiFixSha === input.headSha;
    const nextCount = sameSha ? (cur.ciFixFailureCount ?? 0) + 1 : 1;
    const partial: Partial<PRState> = {
      ciFixFailureCount: nextCount,
      lastFailedCiFixSha: input.headSha,
      lastCiFixFailedAt: new Date().toISOString(),
    };
    return setPR(s, input.prNumber, partial);
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
