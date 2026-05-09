/**
 * `pnpm auto-review` のエントリポイント。
 *
 * polling 型: 60 秒ごとに `gh pr list` で open PR を走査し、
 *   - reviewer mode: head_sha が前回 review と異なる PR を review job に enqueue
 *   - author mode: bot 自身の最新 verdict コメント (REQUEST_CHANGES marker) を未対応なら fix job に enqueue
 *   - merge mode: bot 自身の最新 APPROVE コメント + head_sha 一致 + CI 全 green ならば merge job に enqueue
 *   - index mode: tick 毎に `origin/main` SHA を見て、前回 index 時から動いていたら detached `pnpm graph:build` を kick
 *
 * - 並行度は MAX_CONCURRENT (default 2)
 * - 同 PR の review/fix/merge は per-PR mutex で直列化
 * - iteration cap (review post と fix push それぞれで +1 = 1 round-trip = +2) 超過で当該 PR を stalled としてスキップ
 *
 * SIGINT / SIGTERM で graceful stop (in-flight job を待ってから exit)。
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { runFixJob } from "./fix-job.js";
import { runIndexJob } from "./index-job.js";
import { JobQueue } from "./job-queue.js";
import { runMergeJob } from "./merge-job.js";
import { runReviewJob } from "./review-job.js";
import { loadState, saveState, setPR, StateMutex, type State } from "./state.js";

const execFileP = promisify(execFile);

const REPO = process.env.AUTO_REVIEW_REPO ?? "thujikun/self-management";
const POLL_INTERVAL_MS = parseInt(process.env.AUTO_REVIEW_POLL_INTERVAL_MS ?? "60000", 10);
const MAX_CONCURRENT = parseInt(process.env.AUTO_REVIEW_MAX_CONCURRENT ?? "2", 10);
const MAX_ITERATIONS_PER_PR = parseInt(process.env.AUTO_REVIEW_MAX_ITERATIONS ?? "10", 10);
const REPO_ROOT = process.env.AUTO_REVIEW_REPO_ROOT ?? process.cwd();

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

function isWipTitle(title: string): boolean {
  return /^\s*\[?WIP\]?[\s:]/i.test(title) || /\bWIP:\s/i.test(title);
}

const mutex = new StateMutex();
let state: State = await loadState();

console.log(
  `[auto-review] starting (repo=${REPO}, interval=${POLL_INTERVAL_MS}ms, maxConcurrent=${MAX_CONCURRENT}, maxIterations=${MAX_ITERATIONS_PER_PR})`,
);

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

async function tick(): Promise<void> {
  // index mode: origin/main が動いていたら graph:build を kick (PR scan より前に走らせる、軽いので非 block)
  await runIndexJob({ repoRoot: REPO_ROOT, state, updateState: update }).catch((err: unknown) => {
    console.warn(`[index] tick error:`, err);
    return { state, kicked: false };
  });

  const prs = await listOpenPRs().catch((err: unknown) => {
    console.warn(`[poll] gh pr list failed:`, err);
    return [] as PR[];
  });

  for (const pr of prs) {
    if (pr.isDraft || isWipTitle(pr.title)) continue;
    const cur = state.prs[String(pr.number)] ?? { iterations: 0 };
    if (cur.stalled) continue;
    if (cur.iterations >= MAX_ITERATIONS_PER_PR) {
      console.warn(`[pr-${pr.number}] iteration cap (${cur.iterations}) reached → stalled`);
      await update((s) => setPR(s, pr.number, { stalled: true }));
      continue;
    }

    // Reviewer mode: 前回 review と head_sha が違えば enqueue
    if (cur.lastReviewedSha !== pr.headRefOid) {
      queue.enqueue({
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
    }

    // Author / merge mode: 直近 verdict comment を fetch
    const verdicts = await getBotVerdictComments(pr.number).catch((err: unknown) => {
      console.warn(`[poll pr-${pr.number}] verdict fetch failed:`, err);
      return [] as BotComment[];
    });
    const sorted = [...verdicts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    // Author mode: 最新 REQUEST_CHANGES コメントを未対応なら enqueue
    const latestRC = sorted.find((c) => c.body.includes("VERDICT:REQUEST_CHANGES"));
    if (latestRC && latestRC.id !== cur.lastAddressedCommentId) {
      const reviewBody = latestRC.body;
      const commentId = latestRC.id;
      queue.enqueue({
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
    }

    // Merge mode: 直近 verdict が APPROVE で head_sha 一致 + 未 merge なら enqueue。
    // 「直近 verdict」は REQUEST_CHANGES より新しい APPROVE がある場合のみ APPROVE とみなす
    // (古い APPROVE の後に新しい REQUEST_CHANGES が来ているなら merge しない)。
    const latestVerdict = sorted[0];
    const isApproveLatest = latestVerdict?.body.includes("VERDICT:APPROVE") ?? false;
    if (isApproveLatest && cur.lastMergedSha !== pr.headRefOid) {
      queue.enqueue({
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
    }
  }
}

let stopping = false;
const stop = (sig: string): void => {
  if (stopping) return;
  stopping = true;
  console.log(`\n[auto-review] received ${sig}, draining in-flight jobs...`);
};
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

// 初回 tick = catch-up (起動時 state.json に未記録の open PR を全件処理)
await tick();
while (!stopping) {
  await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  if (stopping) break;
  await tick();
}
await queue.waitIdle();
console.log("[auto-review] stopped");
