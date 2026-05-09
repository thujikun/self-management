/**
 * 軽量 logger。stdout に `[HH:MM:SS] [scope] message` 形式で出力する。
 *
 * - bot 起動時間からの経過秒も併記し、長時間かかる job (claude -p / graph:build) の
 *   どこで時間が消費されたか視覚的に追えるようにする
 * - cortex の auto-review が console.log の prefix で同型のロギングをしているのに合わせ、
 *   解析・grep しやすい固定フォーマットを保つ
 *
 * scope 命名規則:
 *   "[poll]"           — tick lifecycle
 *   "[poll pr-N]"      — 当該 PR に対する poll での scan 結果
 *   "[review pr-N]"    — review job の各段階
 *   "[fix pr-N]"       — fix job の各段階
 *   "[merge pr-N]"     — merge job の各段階
 *   "[index]"          — graph:build kick の状態
 *   "[job <id>]"       — job-queue の lifecycle
 */

const STARTED_AT = Date.now();

/** stdout に時刻 + 起動経過秒 + scope + message を出力する。 */
export function log(scope: string, msg: string): void {
  const now = new Date();
  const hms = now.toTimeString().slice(0, 8);
  const elapsed = ((Date.now() - STARTED_AT) / 1000).toFixed(0);
  console.log(`[${hms}] [+${elapsed}s] ${scope} ${msg}`);
}

/** 同 fmt で stderr に warn 出力する (失敗系の log 用)。 */
export function warn(scope: string, msg: string, err?: unknown): void {
  const now = new Date();
  const hms = now.toTimeString().slice(0, 8);
  const elapsed = ((Date.now() - STARTED_AT) / 1000).toFixed(0);
  if (err === undefined) {
    console.warn(`[${hms}] [+${elapsed}s] ${scope} ${msg}`);
  } else {
    console.warn(`[${hms}] [+${elapsed}s] ${scope} ${msg}`, err);
  }
}

/** ms を h/m/s に整形して返す (人間が読みやすい duration)。 */
export function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m${s.toString().padStart(2, "0")}s`;
}
