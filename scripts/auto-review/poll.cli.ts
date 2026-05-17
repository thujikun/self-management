/**
 * `pnpm auto-review` のエントリポイント。
 *
 * polling 型: 60 秒ごとに `gh pr list` で open PR を走査し、
 *   - reviewer mode: head_sha が前回 review と異なる PR を review job に enqueue
 *   - author mode: bot 自身の最新 verdict コメント (REQUEST_CHANGES marker) を未対応なら fix job に enqueue
 *   - ci-fix mode: bot 自身の最新 APPROVE + CI に failing job あり → ci-fix job に enqueue (bot 自身が CI 失敗を fix)
 *   - merge mode: bot 自身の最新 APPROVE + CI 全 green ならば merge job に enqueue
 *   - index mode: tick 毎に `origin/main` SHA を見て、前回 index 時から動いていたら detached `pnpm graph:build` を kick
 *
 * - 並行度は MAX_CONCURRENT (default 2)
 * - 同 PR の review/fix/ci-fix/merge は per-PR mutex で直列化
 * - iteration cap 超過で当該 PR を stalled としてスキップ (成功 review/fix/ci-fix push で +1 ずつ)
 *
 * 各 tick / job の進捗を `[scope] message` 形式で stdout に逐次ログする (cortex 同型)。
 *
 * SIGINT / SIGTERM で graceful stop (in-flight job を待ってから exit)。
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { runCiFixJob, type FailingCheck } from "./ci-fix-job.js";
import { ciFixEligibility, fixEligibility, reviewEligibility } from "./eligibility.js";
import { runFixJob } from "./fix-job.js";
import { runIndexJob } from "./index-job.js";
import { JobQueue } from "./job-queue.js";
import { log, warn } from "./log.js";
import { runMergeJob } from "./merge-job.js";
import { runReviewJob } from "./review-job.js";
import { loadState, saveState, setPR, StateMutex, type State } from "./state.js";

const execFileP = promisify(execFile);

const REPO = process.env.AUTO_REVIEW_REPO ?? "thujikun/self-management";
const POLL_INTERVAL_MS = parseInt(process.env.AUTO_REVIEW_POLL_INTERVAL_MS ?? "60000", 10);
const MAX_CONCURRENT = parseInt(process.env.AUTO_REVIEW_MAX_CONCURRENT ?? "2", 10);
const MAX_ITERATIONS_PER_PR = parseInt(process.env.AUTO_REVIEW_MAX_ITERATIONS ?? "10", 10);
const REPO_ROOT = process.env.AUTO_REVIEW_REPO_ROOT ?? process.cwd();
/**
 * 起動から `EXIT_AFTER_UPTIME_MS` 経過 + queue idle なら main loop を break して
 * `queue.waitIdle()` の後に natural exit (exit code 0) する。
 * 外側の wrapper script (`loop.sh`) が `git fetch + reset --hard origin/main` してから
 * tsx を再 spawn するので、merge された新コードを自動で取り込んで再起動する形になる。
 * Node の import は同 process 内で再読込されないので、定期的に process を作り直すのが要点。
 * 0 を指定すると self-exit 無効化 (旧 behavior、wrapper 無しでの開発時用)。
 *
 * 非数値 / 部分解釈可能な値 (例: `"abc"`, `""`, `"30m"`) を許すと、`parseInt` が NaN や
 * 想定外の小さい値を返し、wrapper script との組み合わせで「起動 → 即 self-exit → 2 秒で再起動」
 * の暴走 loop に陥る。anti-loop 5 層の趣旨に反するので、起動時に fail-fast する。
 */
const EXIT_AFTER_UPTIME_MS_RAW =
  process.env.AUTO_REVIEW_EXIT_AFTER_UPTIME_MS ?? `${30 * 60 * 1000}`;
if (!/^\d+$/.test(EXIT_AFTER_UPTIME_MS_RAW)) {
  throw new Error(
    `AUTO_REVIEW_EXIT_AFTER_UPTIME_MS must be a non-negative integer (got: ${JSON.stringify(process.env.AUTO_REVIEW_EXIT_AFTER_UPTIME_MS)})`,
  );
}
const EXIT_AFTER_UPTIME_MS = parseInt(EXIT_AFTER_UPTIME_MS_RAW, 10);
/**
 * 失敗 retry 制御:
 *   - 同じ SHA / commentId に対する review/fix の失敗回数が `MAX_*_FAILURES` 未満かつ
 *     最後の失敗から `*_FAILURE_BACKOFF_MS` 以上経過していれば再試行する
 *   - cap 到達後は同 SHA / commentId は skip。新 commit / 新 review が来れば再カウントから始まる
 *   - bookmark しない設計なので「parse 失敗 1 回で永久停止」を防ぐ。一過性 Claude flake が ~5-15 min で自然回復
 */
const MAX_REVIEW_FAILURES_PER_SHA = parseInt(
  process.env.AUTO_REVIEW_MAX_REVIEW_FAILURES ?? "3",
  10,
);
const REVIEW_FAILURE_BACKOFF_MS = parseInt(
  process.env.AUTO_REVIEW_REVIEW_BACKOFF_MS ?? `${5 * 60 * 1000}`,
  10,
);
const MAX_FIX_FAILURES_PER_COMMENT = parseInt(process.env.AUTO_REVIEW_MAX_FIX_FAILURES ?? "3", 10);
const FIX_FAILURE_BACKOFF_MS = parseInt(
  process.env.AUTO_REVIEW_FIX_BACKOFF_MS ?? `${5 * 60 * 1000}`,
  10,
);
const MAX_CI_FIX_FAILURES_PER_SHA = parseInt(
  process.env.AUTO_REVIEW_MAX_CI_FIX_FAILURES ?? "3",
  10,
);
const CI_FIX_FAILURE_BACKOFF_MS = parseInt(
  process.env.AUTO_REVIEW_CI_FIX_BACKOFF_MS ?? `${5 * 60 * 1000}`,
  10,
);

const REVIEW_ELIG_CFG = {
  maxFailuresPerSha: MAX_REVIEW_FAILURES_PER_SHA,
  backoffMs: REVIEW_FAILURE_BACKOFF_MS,
};
const FIX_ELIG_CFG = {
  maxFailuresPerComment: MAX_FIX_FAILURES_PER_COMMENT,
  backoffMs: FIX_FAILURE_BACKOFF_MS,
};
const CI_FIX_ELIG_CFG = {
  maxFailuresPerSha: MAX_CI_FIX_FAILURES_PER_SHA,
  backoffMs: CI_FIX_FAILURE_BACKOFF_MS,
};

interface PR {
  number: number;
  headRefOid: string;
  headRefName: string;
  title: string;
  isDraft: boolean;
}

async function listOpenPRs(): Promise<PR[]> {
  const { stdout } = await execFileP("gh", [
    "pr",
    "list",
    "--repo",
    REPO,
    "--state",
    "open",
    "--json",
    "number,headRefOid,headRefName,title,isDraft",
    "--limit",
    "50",
  ]);
  return JSON.parse(stdout) as PR[];
}

interface BotComment {
  id: number;
  body: string;
  createdAt: string;
}

async function getBotVerdictComments(prNumber: number): Promise<BotComment[]> {
  const { stdout } = await execFileP("gh", [
    "api",
    `repos/${REPO}/issues/${prNumber}/comments`,
    "--paginate",
    "--jq",
    '[.[] | select(.body | contains("AUTO_REVIEW_BODY_START")) | {id, body, createdAt: .created_at}]',
  ]);
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return [];
  return JSON.parse(trimmed) as BotComment[];
}

interface CheckEntry {
  bucket: string;
  name: string;
  link: string;
}

/**
 * `gh pr checks <N>` の生 entries を返す。bucket は "pass" | "fail" | "pending" | "cancel" | "skipping"。
 * 0 件返り = check 自体無し (poll 側で「未準備」扱い)。
 *
 * `gh pr checks` は check が 1 件も登録されていない PR で exit 1 + stderr
 * `no checks reported on the '<branch>' branch` を返す。workflow が未起動 or required check
 * 未定義の benign state なので `[]` に正規化して silent に呑む (warn しない)。
 */
async function fetchPrChecks(prNumber: number): Promise<CheckEntry[]> {
  try {
    const { stdout } = await execFileP("gh", [
      "pr",
      "checks",
      String(prNumber),
      "--repo",
      REPO,
      "--json",
      "bucket,name,link",
    ]);
    if (!stdout.trim()) return [];
    return JSON.parse(stdout) as CheckEntry[];
  } catch (err) {
    if (isNoChecksReportedError(err)) return [];
    throw err;
  }
}

function isNoChecksReportedError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const stderr = (err as { stderr?: unknown }).stderr;
  return typeof stderr === "string" && /no checks reported/i.test(stderr);
}

/**
 * CI 全体 status の集計。
 *   - `"pass"`: 1 件以上あって全て pass / skipping
 *   - `"fail"`: 1 件以上 fail
 *   - `"pending"`: それ以外 (進行中 / 0 件)
 */
function summarizeCiStatus(checks: CheckEntry[]): "pass" | "fail" | "pending" {
  if (checks.length === 0) return "pending";
  if (checks.some((c) => c.bucket === "fail")) return "fail";
  if (checks.every((c) => c.bucket === "pass" || c.bucket === "skipping")) return "pass";
  return "pending";
}

/**
 * CI checks から failing job のみを抽出し、job URL から run_id を parse して FailingCheck[] を返す。
 * link 例: https://github.com/owner/repo/actions/runs/123/job/456 → runId=123
 */
function extractFailingChecks(checks: CheckEntry[]): FailingCheck[] {
  const out: FailingCheck[] = [];
  for (const c of checks) {
    if (c.bucket !== "fail") continue;
    const m = /\/actions\/runs\/(\d+)\//.exec(c.link);
    const runId = m?.[1] ?? "";
    if (!runId) continue;
    out.push({ name: c.name, runId, jobUrl: c.link });
  }
  return out;
}

function isWipTitle(title: string): boolean {
  return /^\s*\[?WIP\]?[\s:]/i.test(title) || /\bWIP:\s/i.test(title);
}

const mutex = new StateMutex();
let state: State = await loadState();

log(
  "[auto-review]",
  `starting (repo=${REPO}, interval=${POLL_INTERVAL_MS}ms, maxConcurrent=${MAX_CONCURRENT}, maxIterations=${MAX_ITERATIONS_PER_PR}, repoRoot=${REPO_ROOT})`,
);
log(
  "[auto-review]",
  `state loaded: ${Object.keys(state.prs).length} PR entries, lastIndexedMainSha=${state.global?.lastIndexedMainSha ?? "<none>"}`,
);

// bot が spawn する `claude -p` は env に CLAUDE_CODE_OAUTH_TOKEN があれば Keychain を読まない。
// 無いと interactive Claude Code と Keychain OAuth credential を共有することになり、
// refresh token rotation が衝突して interactive 側が logout される (実測: 短時間で複数 logout)。
// `claude setup-token` で long-lived token を発行し `.envrc.local` 等で export しておくこと
if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
  log("[auto-review]", `auth: CLAUDE_CODE_OAUTH_TOKEN is set (isolated from Keychain)`);
} else {
  warn(
    "[auto-review]",
    `auth: CLAUDE_CODE_OAUTH_TOKEN is NOT set — bot will share Keychain OAuth with interactive Claude Code sessions, which can cause logout. Run \`claude setup-token\` and export the token to fix`,
  );
}

const queue = new JobQueue({ maxConcurrent: MAX_CONCURRENT });

async function update(updater: (s: State) => State): Promise<State> {
  return mutex.update(
    () => state,
    async (next) => {
      state = next;
      await saveState(next);
    },
    updater,
  );
}

let tickCount = 0;

async function tick(): Promise<void> {
  tickCount++;
  log("[poll]", `tick #${tickCount} begin`);

  // index mode: origin/main が動いていたら graph:build を kick
  const indexResult = await runIndexJob({
    repoRoot: REPO_ROOT,
    state,
    updateState: update,
  }).catch((err: unknown) => {
    warn("[index]", `tick error:`, err);
    return { state, kicked: false };
  });
  if (!indexResult.kicked) {
    log("[index]", `origin/main unchanged, skip`);
  }

  const prs = await listOpenPRs().catch((err: unknown) => {
    warn("[poll]", `gh pr list failed:`, err);
    return [] as PR[];
  });
  log("[poll]", `${prs.length} open PR(s)`);

  let reviewEnqueued = 0;
  let fixEnqueued = 0;
  let ciFixEnqueued = 0;
  let mergeEnqueued = 0;
  let skipped = 0;

  for (const pr of prs) {
    const tag = `[poll pr-${pr.number}]`;
    if (pr.isDraft) {
      log(tag, `skip: draft`);
      skipped++;
      continue;
    }
    if (isWipTitle(pr.title)) {
      log(tag, `skip: WIP title (${pr.title})`);
      skipped++;
      continue;
    }
    const cur = state.prs[String(pr.number)] ?? { iterations: 0 };
    if (cur.stalled) {
      log(tag, `skip: stalled (iteration cap reached previously)`);
      skipped++;
      continue;
    }
    if (cur.iterations >= MAX_ITERATIONS_PER_PR) {
      warn(tag, `iteration cap (${cur.iterations}) reached → mark stalled`);
      await update((s) => setPR(s, pr.number, { stalled: true }));
      skipped++;
      continue;
    }

    log(
      tag,
      `sha=${pr.headRefOid.slice(0, 7)}, branch=${pr.headRefName}, iterations=${cur.iterations}`,
    );

    // Reviewer mode
    const reviewElig = reviewEligibility(pr.headRefOid, cur, Date.now(), REVIEW_ELIG_CFG);
    if (reviewElig.ok) {
      log(
        tag,
        `  reviewer: lastReviewedSha=${cur.lastReviewedSha?.slice(0, 7) ?? "<none>"} ≠ ${pr.headRefOid.slice(0, 7)} → enqueue review (failures=${cur.reviewFailureCount ?? 0})`,
      );
      reviewEnqueued++;
      const accepted = queue.enqueue({
        id: `review-${pr.number}-${pr.headRefOid}`,
        prNumber: pr.number,
        type: "review",
        run: async () => {
          await runReviewJob({
            prNumber: pr.number,
            headSha: pr.headRefOid,
            repo: REPO,
            repoRoot: REPO_ROOT,
            state,
            updateState: update,
            lastReviewBodyHash: cur.lastReviewBodyHash,
          });
        },
      });
      if (!accepted) log(tag, `  reviewer: dedup (already queued / running), skip`);
    } else {
      log(tag, `  reviewer: skip (${reviewElig.reason})`);
    }

    // Author / merge mode: 直近 verdict comment を fetch
    const verdicts = await getBotVerdictComments(pr.number).catch((err: unknown) => {
      warn(tag, `verdict fetch failed:`, err);
      return [] as BotComment[];
    });
    const sorted = [...verdicts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    log(tag, `  ${verdicts.length} bot verdict comment(s) found`);

    // Author mode
    const latestRC = sorted.find((c) => c.body.includes("VERDICT:REQUEST_CHANGES"));
    if (latestRC) {
      const fixElig = fixEligibility(latestRC.id, cur, Date.now(), FIX_ELIG_CFG);
      if (fixElig.ok) {
        log(
          tag,
          `  author: REQUEST_CHANGES comment #${latestRC.id} (lastAddressed=${cur.lastAddressedCommentId ?? "<none>"}) → enqueue fix (failures=${cur.fixFailureCount ?? 0})`,
        );
        fixEnqueued++;
        const reviewBody = latestRC.body;
        const commentId = latestRC.id;
        const accepted = queue.enqueue({
          id: `fix-${pr.number}-${commentId}`,
          prNumber: pr.number,
          type: "fix",
          run: async () => {
            await runFixJob({
              prNumber: pr.number,
              repo: REPO,
              repoRoot: REPO_ROOT,
              branch: pr.headRefName,
              reviewBody,
              commentId,
              state,
              updateState: update,
            });
          },
        });
        if (!accepted) log(tag, `  author: dedup (already queued / running), skip`);
      } else {
        log(tag, `  author: skip (${fixElig.reason})`);
      }
    } else {
      log(tag, `  author: no REQUEST_CHANGES comment → skip`);
    }

    // Merge / ci-fix mode (APPROVE 後の分岐): CI 状態で merge or ci-fix or wait に分かれる
    const latestVerdict = sorted[0];
    const isApproveLatest = latestVerdict?.body.includes("VERDICT:APPROVE") ?? false;
    if (!isApproveLatest) {
      log(tag, `  merge/ci-fix: latest verdict is not APPROVE → skip`);
      continue;
    }
    if (cur.lastMergedSha === pr.headRefOid) {
      log(
        tag,
        `  merge/ci-fix: APPROVE but lastMergedSha matches → skip (already merged or attempted)`,
      );
      continue;
    }
    const checks = await fetchPrChecks(pr.number).catch((err: unknown) => {
      warn(tag, `gh pr checks failed:`, err);
      return [] as CheckEntry[];
    });
    const ciStatus = summarizeCiStatus(checks);
    log(tag, `  merge/ci-fix: ${checks.length} check(s), ci=${ciStatus}`);

    if (ciStatus === "pending") {
      log(tag, `  merge/ci-fix: CI pending → skip (wait for completion)`);
      continue;
    }
    if (ciStatus === "fail") {
      const ciFixElig = ciFixEligibility(pr.headRefOid, cur, Date.now(), CI_FIX_ELIG_CFG);
      if (!ciFixElig.ok) {
        log(tag, `  ci-fix: skip (${ciFixElig.reason})`);
        continue;
      }
      const failingChecks = extractFailingChecks(checks);
      if (failingChecks.length === 0) {
        warn(
          tag,
          `  ci-fix: ciStatus=fail but no failing job URL parsable → skip (re-evaluate next tick)`,
        );
        continue;
      }
      log(
        tag,
        `  ci-fix: ${failingChecks.length} failing check(s) → enqueue ci-fix (failures=${cur.ciFixFailureCount ?? 0})`,
      );
      ciFixEnqueued++;
      const accepted = queue.enqueue({
        id: `ci-fix-${pr.number}-${pr.headRefOid}`,
        prNumber: pr.number,
        type: "fix",
        run: async () => {
          await runCiFixJob({
            prNumber: pr.number,
            headSha: pr.headRefOid,
            repo: REPO,
            repoRoot: REPO_ROOT,
            branch: pr.headRefName,
            failingChecks,
            state,
            updateState: update,
          });
        },
      });
      if (!accepted) log(tag, `  ci-fix: dedup (already queued / running), skip`);
      continue;
    }
    // ciStatus === "pass"
    log(tag, `  merge: CI green → enqueue merge`);
    mergeEnqueued++;
    const accepted = queue.enqueue({
      id: `merge-${pr.number}-${pr.headRefOid}`,
      prNumber: pr.number,
      type: "merge",
      run: async () => {
        await runMergeJob({
          prNumber: pr.number,
          headSha: pr.headRefOid,
          repo: REPO,
          state,
          updateState: update,
        });
      },
    });
    if (!accepted) log(tag, `  merge: dedup (already queued / running), skip`);
  }

  const status = queue.status();
  log(
    "[poll]",
    `tick #${tickCount} end: enqueued=${reviewEnqueued + fixEnqueued + ciFixEnqueued + mergeEnqueued} (review=${reviewEnqueued}, fix=${fixEnqueued}, ci-fix=${ciFixEnqueued}, merge=${mergeEnqueued}), skipped=${skipped}, queue=${status.queued}, running=${status.running}`,
  );
}

let stopping = false;
const stop = (sig: string): void => {
  if (stopping) return;
  stopping = true;
  log("[auto-review]", `received ${sig}, draining in-flight jobs...`);
};
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

const PROCESS_STARTED_AT = Date.now();

/**
 * 「起動から `EXIT_AFTER_UPTIME_MS` 経過 + queue idle」を満たしたら true を返す。
 * 旧 import を抱えたまま走り続けると merge された新コードが反映されないので、
 * 定期的に self-exit して wrapper script に再起動させる (loop.sh が `git reset --hard origin/main`
 * してから tsx を再 spawn する)。
 */
function shouldSelfExit(): boolean {
  if (EXIT_AFTER_UPTIME_MS <= 0) return false;
  const uptime = Date.now() - PROCESS_STARTED_AT;
  if (uptime < EXIT_AFTER_UPTIME_MS) return false;
  const q = queue.status();
  return q.running === 0 && q.queued === 0;
}

// 初回 tick = catch-up (起動時 state.json に未記録の open PR を全件処理)
await tick();
while (!stopping) {
  if (shouldSelfExit()) {
    log(
      "[auto-review]",
      `uptime >= ${EXIT_AFTER_UPTIME_MS}ms + queue idle → self-exit for wrapper restart (picks up latest main)`,
    );
    break;
  }
  await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  if (stopping) break;
  await tick();
}
await queue.waitIdle();
log("[auto-review]", `stopped (after ${tickCount} tick(s))`);
