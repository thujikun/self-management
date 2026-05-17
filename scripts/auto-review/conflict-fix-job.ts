/**
 * Conflict-fix mode: PR が `mergeable: CONFLICTING` のときに bot 自身で conflict を解消する job 実装。
 *
 * 流れ:
 *   1. PR branch worktree 作成 (origin/main を merge 試行、conflict 残存可)
 *   2. claude -p に conflict-fix prompt を投げる (focused: 6 gate 不要 / review 対応不要、
 *      conflict 解消 → merge commit → push のみ)
 *   3. push 検証: worktree HEAD と origin/<branch> の SHA を比較し、本当に push されたか確認
 *      - 成功: `lastConflictFixedSha` を bookmark + `iterations++` (round-trip cap 用)
 *      - 失敗 (FIX_FAILED / push 検出失敗 / timeout / throw): SHA は bookmark **しない**。代わりに
 *        per-SHA の `conflictFixFailureCount` + `lastConflictFixFailedAt` を更新する。poll 側で
 *        backoff 窓 + failure cap を確認した上で、同 SHA の retry を一定 cap まで許可する
 *   4. 完了後 worktree 削除
 *
 * 副作用 (claude spawn / git worktree / git rev-parse / fetch) は `ConflictFixJobDeps` で注入可能。
 * ci-fix-job.ts と並列の構造 (key が CI 失敗 list ではなく conflict 有無である点が違う)。
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
import { buildConflictFixPrompt } from "./prompt-conflict-fix.js";
import { setPR, type PRState, type State } from "./state.js";
import { createBranchWorktree, removeWorktree, type Worktree } from "./worktree.js";

const execFileP = promisify(execFile);

const CLAUDE_LOG_DIR = join(homedir(), ".cache/self-management-auto-review/logs");

export interface ConflictFixJobInput {
  prNumber: number;
  /** 対象 head_sha。state.lastConflictFixedSha / lastFailedConflictFixSha のキー。 */
  headSha: string;
  repo: string;
  repoRoot: string;
  branch: string;
  state: State;
  updateState: (apply: (s: State) => State) => Promise<State>;
}

export interface ConflictFixJobDeps {
  runClaude: (input: ClaudeRunInput) => Promise<ClaudeRunResult>;
  createWorktree: (
    repoRoot: string,
    prNumber: number,
    branch: string,
  ) => Promise<{ wt: Worktree; mergeFailed: boolean; preMergeSha: string }>;
  removeWorktree: (repoRoot: string, wt: Worktree) => Promise<void>;
  revParse: (worktreePath: string, ref: string) => Promise<string>;
  fetchOriginBranch: (worktreePath: string, branch: string) => Promise<void>;
}

export const DEFAULT_CONFLICT_FIX_JOB_DEPS: ConflictFixJobDeps = {
  runClaude,
  createWorktree: createBranchWorktree,
  removeWorktree,
  revParse,
  fetchOriginBranch,
};

export async function runConflictFixJob(
  input: ConflictFixJobInput,
  deps: ConflictFixJobDeps = DEFAULT_CONFLICT_FIX_JOB_DEPS,
): Promise<State> {
  const tag = `[conflict-fix pr-${input.prNumber}]`;
  const jobStart = Date.now();
  log(tag, `start (sha=${input.headSha.slice(0, 7)}, branch=${input.branch})`);
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
    if (!created.mergeFailed) {
      log(
        tag,
        `origin/main merge succeeded locally (conflict cleared by GH between poll and worktree create); AI will still verify and push`,
      );
    }
    log(tag, `pre-merge baseline (origin/${input.branch}) = ${created.preMergeSha.slice(0, 7)}`);

    const prompt = buildConflictFixPrompt({
      prNumber: input.prNumber,
      repo: input.repo,
      branch: input.branch,
      conflictsRemaining: created.mergeFailed,
    });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const logFile = join(CLAUDE_LOG_DIR, `claude-conflict-fix-pr${input.prNumber}-${ts}.log`);
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
      return await recordConflictFixFailure(input);
    }
    if (result.exitCode !== 0) {
      const tail = (result.stderr.trim() || result.stdout.trim()).slice(-500);
      warn(
        tag,
        `claude non-zero exit ${result.exitCode} (runtime failure, not a parse issue) → record failure (will retry after backoff); tail:\n${tail}\n  log=${logFile}`,
      );
      return await recordConflictFixFailure(input);
    }

    const parsed = parseReviewOutput(result.stdout);
    if (parsed.fixFailedReason !== null) {
      warn(
        tag,
        `FIX_FAILED reported: ${parsed.fixFailedReason} → record failure (will retry after backoff); inspect: cat ${logFile}`,
      );
      return await recordConflictFixFailure(input);
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
    // baseline は merge 前 SHA (= origin/<branch>) を使う。
    // mergeFailed=false で worktree 作成中に local merge commit が積まれた case で、AI が
    // その merge commit を push しただけの「変更ゼロ commit、push のみ」が成功扱いになる必要があるため。
    // afterSha が pre-merge から動いている + origin が afterSha に追いついていれば PUSHED とみなす。
    const pushed = afterSha !== created.preMergeSha && afterSha === originSha;
    log(
      tag,
      `push verification: pre-merge=${created.preMergeSha.slice(0, 7)}, after=${afterSha.slice(0, 7)}, origin=${originSha.slice(0, 7)} → ${pushed ? "PUSHED" : "NOT PUSHED"}`,
    );
    if (!pushed) {
      warn(tag, `push not detected → record failure (will retry after backoff)`);
      return await recordConflictFixFailure(input);
    }

    const next = await input.updateState((s) => {
      const cur = s.prs[String(input.prNumber)] ?? { iterations: 0 };
      return setPR(s, input.prNumber, {
        lastConflictFixedSha: input.headSha,
        lastConflictFixedAt: new Date().toISOString(),
        iterations: cur.iterations + 1,
        ...CONFLICT_FIX_FAILURE_CLEAR,
      });
    });
    const itersAfter = next.prs[String(input.prNumber)]?.iterations ?? 0;
    log(
      tag,
      `state updated: lastConflictFixedSha=${input.headSha.slice(0, 7)}, iterations=${itersAfter}`,
    );
    return next;
  } catch (err) {
    warn(tag, `unexpected failure → record failure (will retry after backoff):`, err);
    return await recordConflictFixFailure(input);
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
const CONFLICT_FIX_FAILURE_CLEAR: Pick<
  PRState,
  "conflictFixFailureCount" | "lastFailedConflictFixSha" | "lastConflictFixFailedAt"
> = {
  conflictFixFailureCount: undefined,
  lastFailedConflictFixSha: undefined,
  lastConflictFixFailedAt: undefined,
};

/**
 * 失敗を記録するが SHA は bookmark しない (FIX_FAILED / timeout / push 失敗 / throw 等)。
 * 同 SHA に対する失敗なら count++、SHA が変わっていれば 1 から再カウント。
 * `iterations` は触らない (round-trip cap を失敗で消費しない)。
 */
async function recordConflictFixFailure(input: ConflictFixJobInput): Promise<State> {
  return await input.updateState((s) => {
    const cur = s.prs[String(input.prNumber)] ?? { iterations: 0 };
    const sameSha = cur.lastFailedConflictFixSha === input.headSha;
    const nextCount = sameSha ? (cur.conflictFixFailureCount ?? 0) + 1 : 1;
    const partial: Partial<PRState> = {
      conflictFixFailureCount: nextCount,
      lastFailedConflictFixSha: input.headSha,
      lastConflictFixFailedAt: new Date().toISOString(),
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
