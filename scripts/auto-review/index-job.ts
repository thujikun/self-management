/**
 * Auto-index job: `origin/main` の SHA が前回 index 時点から動いていたら detached process で
 * `pnpm graph:build` を spawn して product graph を再 index する。
 *
 * - poll loop の各 tick で `git fetch origin main` + `git rev-parse origin/main` を取って比較
 * - 異なれば detached `pnpm graph:build` を fire-and-forget で kick
 * - **state.global.lastIndexedMainSha を先に commit してから spawn** する (race window で同 SHA に
 *   対する duplicate kick が起きないように)。state update が throw した場合 spawn しない
 * - graph:build の stdout/stderr は **専用 log file** に redirect (`~/.cache/self-management-auto-review
 *   /logs/graph-build-<TS>.log`)。stdio: "ignore" で discard する旧設計だと failure (BQ MERGE error /
 *   embedding throttle / OOM) が無音で消えるので observability を担保する
 *
 * fire-and-forget の理由: graph:build は BQ MERGE + 大量 embedding 呼び出しで 5-30 分かかる
 * 場合がある。poll loop を block すると review/fix/merge job も止まるため、background spawn
 * 専用にして「次に main SHA が変わるまでもう走らせない」という状態だけ持つ。
 *
 * 副作用 (git fetch / rev-parse / graph:build spawn) は `IndexJobDeps` で注入可能、test 用。
 */

import { execFile, spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { setGlobal, type State } from "./state.js";

const execFileP = promisify(execFile);

const LOG_DIR = join(homedir(), ".cache/self-management-auto-review/logs");

export interface IndexJobInput {
  repoRoot: string;
  state: State;
  updateState: (apply: (s: State) => State) => Promise<State>;
}

export interface IndexJobDeps {
  /** `git fetch origin main && git rev-parse origin/main` 相当を返す。 */
  getOriginMainSha: (repoRoot: string) => Promise<string>;
  /** `pnpm graph:build` を detached process として spawn する (fire-and-forget)。 */
  spawnGraphBuild: (repoRoot: string) => void;
}

export const DEFAULT_INDEX_JOB_DEPS: IndexJobDeps = {
  getOriginMainSha,
  spawnGraphBuild,
};

/**
 * 戻り値: `{ state, kicked }`。`kicked` は graph:build を実際 spawn したかどうか。
 * SHA 取得失敗や 一致時は kicked=false で state 不変。
 */
export async function runIndexJob(
  input: IndexJobInput,
  deps: IndexJobDeps = DEFAULT_INDEX_JOB_DEPS,
): Promise<{ state: State; kicked: boolean }> {
  let mainSha: string;
  try {
    mainSha = await deps.getOriginMainSha(input.repoRoot);
  } catch (err) {
    console.warn(`[index] failed to get origin/main sha:`, err);
    return { state: input.state, kicked: false };
  }
  const last = input.state.global?.lastIndexedMainSha;
  if (last === mainSha) {
    return { state: input.state, kicked: false };
  }
  console.log(`[index] origin/main moved (${last ?? "<none>"} → ${mainSha}), kicking graph:build`);
  // **先に state を update** してから spawn する (順序逆だと state update throw 時に
  // spawn 済 + state 古い → 次 tick で同 SHA に対して 2 回目の graph:build が走る race)
  const next = await input.updateState((s) =>
    setGlobal(s, {
      lastIndexedMainSha: mainSha,
      lastIndexedAt: new Date().toISOString(),
    }),
  );
  deps.spawnGraphBuild(input.repoRoot);
  return { state: next, kicked: true };
}

async function getOriginMainSha(repoRoot: string): Promise<string> {
  await execFileP("git", ["-C", repoRoot, "fetch", "origin", "main"], { timeout: 60_000 });
  const { stdout } = await execFileP("git", ["-C", repoRoot, "rev-parse", "origin/main"], {
    timeout: 30_000,
  });
  return stdout.trim();
}

function spawnGraphBuild(repoRoot: string): void {
  // log file に redirect することで failure (BQ MERGE error / embedding throttle / OOM 等) を
  // 後から追える。stdio: "ignore" だと無音で消えるので observability gap が生じる。
  mkdirSync(LOG_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = join(LOG_DIR, `graph-build-${ts}.log`);
  const fd = openSync(logPath, "a");
  const child = spawn("pnpm", ["graph:build"], {
    cwd: repoRoot,
    detached: true,
    stdio: ["ignore", fd, fd],
  });
  child.unref();
  console.log(`[index] spawned pnpm graph:build (pid=${child.pid}) → ${logPath}`);
}
