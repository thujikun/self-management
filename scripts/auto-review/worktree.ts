/**
 * git worktree の作成 / 削除ヘルパ。
 *
 * - reviewer mode は detached worktree (read-only review、`<head_sha>` を checkout)
 * - author mode は branch 付き worktree (commit + push を許す)
 * - `~/.cache/self-management-auto-review/worktrees/` 配下に作る
 *   (`/private/var/folders` の OS auto-clean を避けるため HOME 配下を使う)
 *
 * 副次: 作成時に `${repoRoot}/.mcp.json` が存在すれば worktree 直下に copy する。
 * `.mcp.json` は gitignore のため `git worktree add` だと持ち込まれず、bot の `claude -p` が
 * project-scope MCP (ryan-graph / xmcp-* / grafana-personal 等) にアクセスできなくなる。
 * file 自体を copy することで grep / Read 経由の impact 分析を graph 経由に置き換えられる
 * (= ryan-graph で 1 query が grep ファイル走査の数十倍速い)。
 */

import { execFile } from "node:child_process";
import { copyFile, mkdir, rm } from "node:fs/promises";
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
  await copyMcpConfig(repoRoot, path);
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
  await copyMcpConfig(repoRoot, path);
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

/**
 * `${repoRoot}/.mcp.json` (project-scope MCP config) が存在すれば worktree path 直下に copy する。
 *
 * 設計意図:
 *   - `.mcp.json` は `.gitignore` 済 (secrets / 内部 URL を含むので public commit 不可)
 *   - `git worktree add` は tracked file しか持ち込まないため、worktree 内では project MCP が
 *     登録されず bot の `claude -p` は graph / xmcp 系を呼べない → grep / Read fallback で遅い
 *   - ENOENT (file 不在) は dev 環境で `.mcp.json` を持ってないだけなので silent に呑む。
 *     他の I/O error は warn ログのみで worktree 作成は継続する (graph 不在で動くこと自体は可能)
 *
 * export しているのは test 用 (副作用が file I/O のみで test 容易)。production caller は
 * `createBranchWorktree` / `createReadOnlyWorktree` 経由で間接的に呼ぶ。
 */
export async function copyMcpConfig(repoRoot: string, worktreePath: string): Promise<void> {
  const src = join(repoRoot, ".mcp.json");
  const dst = join(worktreePath, ".mcp.json");
  try {
    await copyFile(src, dst);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return;
    console.error(`[worktree] copy .mcp.json failed (non-fatal):`, err);
  }
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
