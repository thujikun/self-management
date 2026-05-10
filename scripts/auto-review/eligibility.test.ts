/**
 * eligibility.ts の reviewEligibility / fixEligibility 判定 test。
 *
 * 検証する分岐:
 *   - 成功 bookmark あり → skip
 *   - 失敗 0 回 / 異 SHA → enqueue 可
 *   - 同 SHA で失敗 backoff 窓内 → skip (remain 表示あり)
 *   - 同 SHA で失敗 backoff 窓超過 → enqueue 可
 *   - 同 SHA で失敗 cap 到達 → skip
 *   - 失敗 SHA は記録あるが SHA が変わった → enqueue 可 (count 0 扱い)
 */

import { describe, expect, it } from "vitest";

import {
  fixEligibility,
  reviewEligibility,
  type FixEligibilityConfig,
  type ReviewEligibilityConfig,
} from "./eligibility.js";
import type { PRState } from "./state.js";

const REVIEW_CFG: ReviewEligibilityConfig = { maxFailuresPerSha: 3, backoffMs: 5 * 60 * 1000 };
const FIX_CFG: FixEligibilityConfig = { maxFailuresPerComment: 3, backoffMs: 5 * 60 * 1000 };

const NOW = new Date("2026-05-10T08:00:00.000Z").getTime();

describe("reviewEligibility", () => {
  it("lastReviewedSha 一致 → skip", () => {
    const cur: PRState = { iterations: 0, lastReviewedSha: "abc123" };
    expect(reviewEligibility("abc123", cur, NOW, REVIEW_CFG)).toStrictEqual({
      ok: false,
      reason: "lastReviewedSha matches",
    });
  });

  it("失敗履歴なし → enqueue 可", () => {
    const cur: PRState = { iterations: 0 };
    expect(reviewEligibility("abc123", cur, NOW, REVIEW_CFG)).toStrictEqual({ ok: true });
  });

  it("失敗 SHA が異なる (新 commit) → enqueue 可", () => {
    const cur: PRState = {
      iterations: 0,
      reviewFailureCount: 5,
      lastFailedReviewSha: "old_sha",
      lastReviewFailedAt: new Date(NOW - 10_000).toISOString(),
    };
    expect(reviewEligibility("new_sha", cur, NOW, REVIEW_CFG)).toStrictEqual({ ok: true });
  });

  it("同 SHA で backoff 窓内 → skip (残り秒表示)", () => {
    const cur: PRState = {
      iterations: 0,
      reviewFailureCount: 1,
      lastFailedReviewSha: "abc123",
      lastReviewFailedAt: new Date(NOW - 60_000).toISOString(), // 60s 前
    };
    const r = reviewEligibility("abc123", cur, NOW, REVIEW_CFG);
    expect(r).toStrictEqual({
      ok: false,
      reason: "review backoff: retry in 240s (failures=1/3)",
    });
  });

  it("同 SHA で backoff 窓超過 (cap 未満) → enqueue 可", () => {
    const cur: PRState = {
      iterations: 0,
      reviewFailureCount: 2,
      lastFailedReviewSha: "abc123",
      lastReviewFailedAt: new Date(NOW - 6 * 60 * 1000).toISOString(), // 6 分前
    };
    expect(reviewEligibility("abc123", cur, NOW, REVIEW_CFG)).toStrictEqual({ ok: true });
  });

  it("同 SHA で cap 到達 → skip (backoff 関係なく)", () => {
    const cur: PRState = {
      iterations: 0,
      reviewFailureCount: 3,
      lastFailedReviewSha: "abc123",
      lastReviewFailedAt: new Date(NOW - 24 * 60 * 60 * 1000).toISOString(), // 1 日前
    };
    expect(reviewEligibility("abc123", cur, NOW, REVIEW_CFG)).toStrictEqual({
      ok: false,
      reason: "review failure cap reached (3/3) for sha=abc123; awaiting new commit",
    });
  });
});

describe("fixEligibility", () => {
  it("lastAddressedCommentId 一致 → skip", () => {
    const cur: PRState = { iterations: 0, lastAddressedCommentId: 100 };
    expect(fixEligibility(100, cur, NOW, FIX_CFG)).toStrictEqual({
      ok: false,
      reason: "already addressed",
    });
  });

  it("失敗履歴なし → enqueue 可", () => {
    const cur: PRState = { iterations: 0 };
    expect(fixEligibility(100, cur, NOW, FIX_CFG)).toStrictEqual({ ok: true });
  });

  it("失敗 commentId が異なる (新 review) → enqueue 可", () => {
    const cur: PRState = {
      iterations: 0,
      fixFailureCount: 5,
      lastFailedFixCommentId: 99,
      lastFixFailedAt: new Date(NOW - 10_000).toISOString(),
    };
    expect(fixEligibility(100, cur, NOW, FIX_CFG)).toStrictEqual({ ok: true });
  });

  it("同 commentId で backoff 窓内 → skip", () => {
    const cur: PRState = {
      iterations: 0,
      fixFailureCount: 1,
      lastFailedFixCommentId: 100,
      lastFixFailedAt: new Date(NOW - 30_000).toISOString(), // 30s 前
    };
    expect(fixEligibility(100, cur, NOW, FIX_CFG)).toStrictEqual({
      ok: false,
      reason: "fix backoff: retry in 270s (failures=1/3)",
    });
  });

  it("同 commentId で cap 到達 → skip", () => {
    const cur: PRState = {
      iterations: 0,
      fixFailureCount: 3,
      lastFailedFixCommentId: 100,
      lastFixFailedAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
    };
    expect(fixEligibility(100, cur, NOW, FIX_CFG)).toStrictEqual({
      ok: false,
      reason: "fix failure cap reached (3/3) for comment#100; awaiting new review",
    });
  });

  it("同 commentId で backoff 窓超過 (cap 未満) → enqueue 可", () => {
    const cur: PRState = {
      iterations: 0,
      fixFailureCount: 2,
      lastFailedFixCommentId: 100,
      lastFixFailedAt: new Date(NOW - 6 * 60 * 1000).toISOString(),
    };
    expect(fixEligibility(100, cur, NOW, FIX_CFG)).toStrictEqual({ ok: true });
  });
});
