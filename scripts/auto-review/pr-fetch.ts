/**
 * `gh` CLI を叩いて open PR / bot コメント / CI checks を取得するヘルパ群 (pure-ish: 副作用は gh CLI のみ)。
 *
 * poll.cli.ts から切り出した: 同ファイルに留めると行数 cap (500 lines) を超えるため。
 * gh CLI を直接呼ぶ薄い wrapper + 純粋な集計関数 (summarize / extract / WIP 判定) を含む。
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { FailingCheck } from "./ci-fix-job.js";

const execFileP = promisify(execFile);

/**
 * `mergeable`:
 *   - `"MERGEABLE"`: conflict なし (BEHIND だけの可能性あり)
 *   - `"CONFLICTING"`: conflict あり
 *   - `"UNKNOWN"`: GH 側で computation 進行中 (新 commit 直後等)
 *
 * `mergeStateStatus`:
 *   - `"BEHIND"`: branch protection の "require up-to-date" 設定の下で base に対して遅れている (conflict なし)
 *   - `"BLOCKED"`: review 未承認 / CI 未完了 / 他の protection rule で block
 *   - `"CLEAN"`: 全条件 pass、merge 可
 *   - `"DIRTY"`: conflict あり
 *   - `"DRAFT"`: draft PR
 *   - `"HAS_HOOKS"` / `"UNSTABLE"` / `"UNKNOWN"`: 中間状態
 */
export interface PR {
  number: number;
  headRefOid: string;
  headRefName: string;
  title: string;
  isDraft: boolean;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN" | string;
  mergeStateStatus: string;
}

export interface BotComment {
  id: number;
  body: string;
  createdAt: string;
}

export interface CheckEntry {
  bucket: string;
  name: string;
  link: string;
}

export async function listOpenPRs(repo: string): Promise<PR[]> {
  const { stdout } = await execFileP("gh", [
    "pr",
    "list",
    "--repo",
    repo,
    "--state",
    "open",
    "--json",
    "number,headRefOid,headRefName,title,isDraft,mergeable,mergeStateStatus",
    "--limit",
    "50",
  ]);
  return JSON.parse(stdout) as PR[];
}

export async function getBotVerdictComments(repo: string, prNumber: number): Promise<BotComment[]> {
  const { stdout } = await execFileP("gh", [
    "api",
    `repos/${repo}/issues/${prNumber}/comments`,
    "--paginate",
    "--jq",
    '[.[] | select(.body | contains("AUTO_REVIEW_BODY_START")) | {id, body, createdAt: .created_at}]',
  ]);
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return [];
  return JSON.parse(trimmed) as BotComment[];
}

/**
 * `gh pr checks <N>` の生 entries を返す。bucket は "pass" | "fail" | "pending" | "cancel" | "skipping"。
 * 0 件返り = check 自体無し (poll 側で「未準備」扱い)。
 *
 * `gh pr checks` は check が 1 件も登録されていない PR で exit 1 + stderr
 * `no checks reported on the '<branch>' branch` を返す。workflow が未起動 or required check
 * 未定義の benign state なので `[]` に正規化して silent に呑む (warn しない)。
 */
export async function fetchPrChecks(repo: string, prNumber: number): Promise<CheckEntry[]> {
  try {
    const { stdout } = await execFileP("gh", [
      "pr",
      "checks",
      String(prNumber),
      "--repo",
      repo,
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

export function isNoChecksReportedError(err: unknown): boolean {
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
export function summarizeCiStatus(checks: CheckEntry[]): "pass" | "fail" | "pending" {
  if (checks.length === 0) return "pending";
  if (checks.some((c) => c.bucket === "fail")) return "fail";
  if (checks.every((c) => c.bucket === "pass" || c.bucket === "skipping")) return "pass";
  return "pending";
}

/**
 * CI checks から failing job のみを抽出し、job URL から run_id を parse して FailingCheck[] を返す。
 * link 例: https://github.com/owner/repo/actions/runs/123/job/456 → runId=123
 */
export function extractFailingChecks(checks: CheckEntry[]): FailingCheck[] {
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

export function isWipTitle(title: string): boolean {
  return /^\s*\[?WIP\]?[\s:]/i.test(title) || /\bWIP:\s/i.test(title);
}
