/**
 * 永続 state (atomic JSON)。
 *
 * - 各 PR の最終 review 状況 / 最終 fix 対応 commentId / iteration counter を保持
 * - 起動時 load → 各 job 完了時に updateState 経由で書き換え + atomic write (tmp → rename)
 * - 場所は `~/.cache/self-management-auto-review/state.json` (`loadState` / `saveState` の path 引数で override 可、test 用)
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";

export interface PRState {
  /** 最後にレビューした head_sha。次回 poll で同 SHA なら skip。 */
  lastReviewedSha?: string;
  /** 最後にレビューした ISO timestamp。 */
  lastReviewedAt?: string;
  /** 直近レビュー本文の正規化 hash。NO_OP 判定で使う。 */
  lastReviewBodyHash?: string;
  /** 最後に fix 対応した GitHub comment ID。次回 poll で同 ID なら skip。 */
  lastAddressedCommentId?: number;
  /** 最後に fix 対応した ISO timestamp。 */
  lastAddressedAt?: string;
  /** 最後に fix 対応した review 本文の正規化 hash。 */
  lastAddressedBodyHash?: string;
  /** review post と fix push それぞれで +1 (= 1 round-trip = +2)。APPROVE で 0 reset。 */
  iterations: number;
  /** iteration cap 超過で true。両モードが当該 PR を skip。 */
  stalled?: boolean;
  /** auto-merge が成功した head_sha (再 merge 試行を抑止)。 */
  lastMergedSha?: string;
  /** auto-merge 成功時刻 (ISO timestamp)。 */
  lastMergedAt?: string;
  /**
   * review (parse 失敗 / timeout / throw) の per-SHA 失敗回数。
   * SHA が変わったら 1 から再カウント。`MAX_REVIEW_FAILURES_PER_SHA` 到達で skip。
   */
  reviewFailureCount?: number;
  /** review 失敗をカウントしている対象 SHA (新 SHA で count リセット判定に使う)。 */
  lastFailedReviewSha?: string;
  /** review 失敗の ISO timestamp。backoff 窓判定に使う。 */
  lastReviewFailedAt?: string;
  /**
   * fix (FIX_FAILED / timeout / push 検出失敗 / throw) の per-commentId 失敗回数。
   * commentId が変われば (= 新 review が来れば) 1 から再カウント。
   */
  fixFailureCount?: number;
  /** fix 失敗をカウントしている対象 commentId。 */
  lastFailedFixCommentId?: number;
  /** fix 失敗の ISO timestamp。backoff 窓判定に使う。 */
  lastFixFailedAt?: string;
  /**
   * ci-fix (APPROVE 後の CI 失敗を bot が修正する mode) の per-SHA 成功記録。
   * 同 SHA に対する再 ci-fix を抑止 (新 commit が来れば SHA が変わって再 attempt 可能)。
   */
  lastCiFixedSha?: string;
  /** ci-fix push 成功時刻 (ISO timestamp)。 */
  lastCiFixedAt?: string;
  /**
   * ci-fix (FIX_FAILED / timeout / push 検出失敗 / throw) の per-SHA 失敗回数。
   * SHA が変われば 1 から再カウント。`MAX_CI_FIX_FAILURES_PER_SHA` 到達で skip。
   */
  ciFixFailureCount?: number;
  /** ci-fix 失敗をカウントしている対象 SHA。 */
  lastFailedCiFixSha?: string;
  /** ci-fix 失敗の ISO timestamp。backoff 窓判定に使う。 */
  lastCiFixFailedAt?: string;
}

export interface State {
  prs: Record<string, PRState>;
  /** auto-index 用 global 状態。`origin/main` SHA をキーに二重 index を抑止。 */
  global?: {
    lastIndexedMainSha?: string;
    lastIndexedAt?: string;
  };
}

export const DEFAULT_STATE_PATH = `${homedir()}/.cache/self-management-auto-review/state.json`;

/** state.json を読み込む。存在しなければ空 state。 */
export async function loadState(path: string = DEFAULT_STATE_PATH): Promise<State> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<State>;
    const out: State = { prs: parsed.prs ?? {} };
    if (parsed.global) out.global = parsed.global;
    return out;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { prs: {} };
    throw err;
  }
}

/** state を atomic に書き出す (tmp → rename)。 */
export async function saveState(state: State, path: string = DEFAULT_STATE_PATH): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
  await rename(tmp, path);
}

/** PR ごとの state を取得。未登録なら iterations: 0 の空 state。 */
export function getPR(state: State, prNumber: number): PRState {
  return state.prs[String(prNumber)] ?? { iterations: 0 };
}

/** PR の state を partial で更新 (immutable copy 返却)。 */
export function setPR(state: State, prNumber: number, partial: Partial<PRState>): State {
  const current = getPR(state, prNumber);
  return {
    ...state,
    prs: {
      ...state.prs,
      [String(prNumber)]: { ...current, ...partial },
    },
  };
}

/** global state を partial で更新 (immutable copy 返却)。 */
export function setGlobal(state: State, partial: NonNullable<State["global"]>): State {
  return {
    ...state,
    global: { ...(state.global ?? {}), ...partial },
  };
}

/**
 * State 更新を直列化する mutex chain。複数 job が並行で saveState すると
 * last-write-wins で更新が消えるので、updater 関数を順次適用する。
 */
export class StateMutex {
  private chain: Promise<unknown> = Promise.resolve();

  /** updater(current) → next state を chain 内で順次実行。 */
  async update(
    current: () => State,
    apply: (newState: State) => Promise<void>,
    updater: (s: State) => State,
  ): Promise<State> {
    const next = this.chain.then(async () => {
      const updated = updater(current());
      await apply(updated);
      return updated;
    });
    this.chain = next.catch(() => undefined);
    return next as Promise<State>;
  }
}
