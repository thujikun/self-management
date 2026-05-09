/**
 * git worktree の作成 / 削除ヘルパ。
 *
 * - reviewer mode は detached worktree (read-only review、`<head_sha>` を checkout)
 * - author mode は branch 付き worktree (commit + push を許す)
 * - cortex 同型で `~/.cache/self-management-auto-review/worktrees/` 配下に作る
 *   (`/private/var/folders` の OS auto-clean を避けるため HOME 配下を使う)
 */

import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export const WORKTREE_BASE_DIR = `${homedir()}/.cache/self-management-auto-review/worktrees`;

export interface Worktree {
  path: string;
  prNumber: number;
}

/** read-only review 用: detached HEAD で head_sha を checkout した worktree。 */
export async function createReadOnlyWorktree(
  repoRoot: string,
  prNumber: number,
  headSha: string,
): Promise<Worktree> {
  await mkdir(WORKTREE_BASE_DIR, { recursive: true });
  const path = join(WORKTREE_BASE_DIR, `pr-${prNumber}-review-${Date.now()}`);
  // GitHub PR head は通常の origin ref には無いので pull/<N>/head を取得
  await execFileP("git", ["-C", repoRoot, "fetch", "origin", `pull/${prNumber}/head`], {
    timeout: 60_000,
  });
  await execFileP("git", ["-C", repoRoot, "worktree", "add", "--detach", path, headSha], {
    timeout: 60_000,
  });
  return { path, prNumber };
}

/** author mode 用: PR branch を checkout して push 可能にする worktree。origin/main の merge も試行。 */
export async function createBranchWorktree(
  repoRoot: string,
  prNumber: number,
  branch: string,
  baseBranch: string = "main",
): Promise<{ wt: Worktree; mergeFailed: boolean }> {
  await mkdir(WORKTREE_BASE_DIR, { recursive: true });
  const path = join(WORKTREE_BASE_DIR, `pr-${prNumber}-fix-${Date.now()}`);
  await execFileP("git", ["-C", repoRoot, "fetch", "origin", branch, baseBranch], {
    timeout: 60_000,
  });
  await execFileP(
    "git",
    ["-C", repoRoot, "worktree", "add", path, "-B", branch, `origin/${branch}`],
    { timeout: 60_000 },
  );
  // origin/main を merge (pre-emptive)。conflict 残っても worktree は返す。
  let mergeFailed = false;
  try {
    await execFileP("git", ["-C", path, "merge", `origin/${baseBranch}`, "--no-edit"], {
      timeout: 60_000,
    });
  } catch {
    mergeFailed = true;
  }
  return { wt: { path, prNumber }, mergeFailed };
}

/** worktree を削除する (force)。失敗したら fs から rm でフォールバック。 */
export async function removeWorktree(repoRoot: string, wt: Worktree): Promise<void> {
  try {
    await execFileP("git", ["-C", repoRoot, "worktree", "remove", "--force", wt.path], {
      timeout: 60_000,
    });
  } catch {
    await rm(wt.path, { recursive: true, force: true });
  }
}
