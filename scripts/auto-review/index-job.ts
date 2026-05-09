/**
 * Auto-index job: `origin/main` の SHA が前回 index 時点から動いていたら detached process で
 * `pnpm graph:build` を spawn して product graph を再 index する。
 *
 * - poll loop の各 tick で `git fetch origin main` + `git rev-parse origin/main` を取って比較
 * - 異なれば detached `pnpm graph:build` を fire-and-forget で kick (output は graph build log に流れる)
 * - state.global.lastIndexedMainSha を bookmark して二重 kick を防ぐ
 *
 * fire-and-forget の理由: graph:build は BQ MERGE + 大量 embedding 呼び出しで 5-30 分かかる
 * 場合がある。poll loop を block すると review/fix/merge job も止まるため、background spawn
 * 専用にして「次に main SHA が変わるまでもう走らせない」という状態だけ持つ。
 *
 * 副作用 (git fetch / rev-parse / graph:build spawn) は `IndexJobDeps` で注入可能、test 用。
 */

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

import { setGlobal, type State } from "./state.js";

const execFileP = promisify(execFile);

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
  deps.spawnGraphBuild(input.repoRoot);
  const next = await input.updateState((s) =>
    setGlobal(s, {
      lastIndexedMainSha: mainSha,
      lastIndexedAt: new Date().toISOString(),
    }),
  );
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
  const child = spawn("pnpm", ["graph:build"], {
    cwd: repoRoot,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  console.log(`[index] spawned pnpm graph:build (pid=${child.pid}) detached`);
}
