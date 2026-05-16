/**
 * review/fix の再エンキュー判定 (pure function)。
 *
 * - poll loop で各 tick 毎に呼び出し、enqueue するか skip するかを決める
 * - 失敗時は state に SHA bookmark せず `*FailureCount` + `last*FailedAt` を記録する設計のため、
 *   ここで「同じ SHA / commentId に対する失敗が cap 未満で、かつ backoff 窓を超えている」かを判定する
 * - 副作用なし。state の差分を読むだけ
 */

import type { PRState } from "./state.js";

export interface ReviewEligibilityConfig {
  maxFailuresPerSha: number;
  backoffMs: number;
}

export interface FixEligibilityConfig {
  maxFailuresPerComment: number;
  backoffMs: number;
}

export type EligibilityResult = { ok: true } | { ok: false; reason: string };

/**
 * review 再エンキュー判定。
 * - 既に当該 SHA を成功 review 済みなら skip
 * - 失敗 cap に達していたら skip (新 SHA が来るまで諦める)
 * - 失敗 backoff 窓内なら skip (`<remain>s` で次の retry 可能)
 * - それ以外は enqueue 可
 */
export function reviewEligibility(
  headSha: string,
  cur: PRState,
  now: number,
  cfg: ReviewEligibilityConfig,
): EligibilityResult {
  if (cur.lastReviewedSha === headSha) {
    return { ok: false, reason: "lastReviewedSha matches" };
  }
  const sameFailedSha = cur.lastFailedReviewSha === headSha;
  const failures = sameFailedSha ? (cur.reviewFailureCount ?? 0) : 0;
  if (failures >= cfg.maxFailuresPerSha) {
    return {
      ok: false,
      reason: `review failure cap reached (${failures}/${cfg.maxFailuresPerSha}) for sha=${headSha.slice(0, 7)}; awaiting new commit`,
    };
  }
  if (sameFailedSha && cur.lastReviewFailedAt) {
    const since = now - new Date(cur.lastReviewFailedAt).getTime();
    if (since < cfg.backoffMs) {
      const remain = Math.ceil((cfg.backoffMs - since) / 1000);
      return {
        ok: false,
        reason: `review backoff: retry in ${remain}s (failures=${failures}/${cfg.maxFailuresPerSha})`,
      };
    }
  }
  return { ok: true };
}

/**
 * fix 再エンキュー判定 (commentId をキー)。
 * - 既に当該 commentId を成功 fix 済みなら skip
 * - 失敗 cap に達していたら skip (新 review = 新 commentId が来るまで諦める)
 * - 失敗 backoff 窓内なら skip
 */
export function fixEligibility(
  commentId: number,
  cur: PRState,
  now: number,
  cfg: FixEligibilityConfig,
): EligibilityResult {
  if (cur.lastAddressedCommentId === commentId) {
    return { ok: false, reason: "already addressed" };
  }
  const sameFailedComment = cur.lastFailedFixCommentId === commentId;
  const failures = sameFailedComment ? (cur.fixFailureCount ?? 0) : 0;
  if (failures >= cfg.maxFailuresPerComment) {
    return {
      ok: false,
      reason: `fix failure cap reached (${failures}/${cfg.maxFailuresPerComment}) for comment#${commentId}; awaiting new review`,
    };
  }
  if (sameFailedComment && cur.lastFixFailedAt) {
    const since = now - new Date(cur.lastFixFailedAt).getTime();
    if (since < cfg.backoffMs) {
      const remain = Math.ceil((cfg.backoffMs - since) / 1000);
      return {
        ok: false,
        reason: `fix backoff: retry in ${remain}s (failures=${failures}/${cfg.maxFailuresPerComment})`,
      };
    }
  }
  return { ok: true };
}

export interface CiFixEligibilityConfig {
  maxFailuresPerSha: number;
  backoffMs: number;
}

/**
 * ci-fix 再エンキュー判定 (head_sha をキー)。
 * - 既に当該 SHA を成功 ci-fix 済みなら skip (= 既に push 済、新 SHA を待つ)
 * - 失敗 cap に達していたら skip (新 commit を待つ。同 SHA に対して無限に retry しない)
 * - 失敗 backoff 窓内なら skip
 */
export function ciFixEligibility(
  headSha: string,
  cur: PRState,
  now: number,
  cfg: CiFixEligibilityConfig,
): EligibilityResult {
  if (cur.lastCiFixedSha === headSha) {
    return { ok: false, reason: "already ci-fixed for this sha" };
  }
  const sameFailedSha = cur.lastFailedCiFixSha === headSha;
  const failures = sameFailedSha ? (cur.ciFixFailureCount ?? 0) : 0;
  if (failures >= cfg.maxFailuresPerSha) {
    return {
      ok: false,
      reason: `ci-fix failure cap reached (${failures}/${cfg.maxFailuresPerSha}) for sha=${headSha.slice(0, 7)}; awaiting new commit`,
    };
  }
  if (sameFailedSha && cur.lastCiFixFailedAt) {
    const since = now - new Date(cur.lastCiFixFailedAt).getTime();
    if (since < cfg.backoffMs) {
      const remain = Math.ceil((cfg.backoffMs - since) / 1000);
      return {
        ok: false,
        reason: `ci-fix backoff: retry in ${remain}s (failures=${failures}/${cfg.maxFailuresPerSha})`,
      };
    }
  }
  return { ok: true };
}
