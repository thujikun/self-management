/**
 * 永続 state (atomic JSON)。
 *
 * - 各 PR の最終 review 状況 / 最終 fix 対応 commentId / iteration counter を保持
 * - 起動時 load → 各 job 完了時に updateState 経由で書き換え + atomic write (tmp → rename)
 * - 場所は `~/.cache/self-management-auto-review/state.json` (`STATE_PATH` で override 可)
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
  /** review post / fix push 1 ペアあたり +1。APPROVE で 0 reset。 */
  iterations: number;
  /** iteration cap 超過で true。両モードが当該 PR を skip。 */
  stalled?: boolean;
}

export interface State {
  prs: Record<string, PRState>;
}

export const DEFAULT_STATE_PATH = `${homedir()}/.cache/self-management-auto-review/state.json`;

/** state.json を読み込む。存在しなければ空 state。 */
export async function loadState(path: string = DEFAULT_STATE_PATH): Promise<State> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<State>;
    return { prs: parsed.prs ?? {} };
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
