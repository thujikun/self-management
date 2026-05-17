/**
 * `$slug.actions.ts` の business logic (executeLikeAction / executeAddCommentAction /
 * dispatchLikeClick / dispatchCommentSubmit) を vi.fn 注入で網羅。React state を
 * 持たない pure 化された層なので、setter / server fn / invalidate を全部 fake で渡し、
 * 状態遷移 + side-effect を直接 assert する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business post detail の like / comment client logic を pure 化した module
 * の network / state setter 経路の網羅。auth gate / submitting gate / success / error
 * の各分岐を踏み、副作用 (setter 呼出し順 + invalidate) を直接観測する
 * @graph-connects none
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  dispatchCommentSubmit,
  dispatchLikeClick,
  executeAddCommentAction,
  executeLikeAction,
} from "./$slug.actions.js";

describe("executeLikeAction", () => {
  it("ok: toggleLikeFn の結果を `{ ok: true, likes }` で返す", async () => {
    const toggleLikeFn = vi.fn().mockResolvedValue({ liked: true, count: 1 });
    const result = await executeLikeAction(toggleLikeFn, "foo");
    expect(result).toStrictEqual({ ok: true, likes: { liked: true, count: 1 } });
    expect(toggleLikeFn).toHaveBeenCalledWith({ data: "foo" });
  });

  it("error: throw された Error.message を取り出す", async () => {
    const toggleLikeFn = vi.fn().mockRejectedValue(new Error("rate limit"));
    expect(await executeLikeAction(toggleLikeFn, "x")).toStrictEqual({
      ok: false,
      error: "rate limit",
    });
  });

  it("error: 非 Error throw は generic message に fallback", async () => {
    const toggleLikeFn = vi.fn().mockRejectedValue("string error");
    expect(await executeLikeAction(toggleLikeFn, "x")).toStrictEqual({
      ok: false,
      error: "like failed",
    });
  });
});

describe("executeAddCommentAction", () => {
  it("ok: trim 後の body を addCommentFn に渡し、戻り値の comment を返す", async () => {
    const comment = {
      id: "c1",
      authorName: "x",
      authorId: "u1",
      body: "hi",
      createdAt: "2026-01-01",
      parentCommentId: null,
    };
    const addCommentFn = vi.fn().mockResolvedValue(comment);
    const result = await executeAddCommentAction(addCommentFn, { slug: "s", body: "  hi  " });
    expect(result).toStrictEqual({ ok: true, comment });
    expect(addCommentFn).toHaveBeenCalledWith({
      data: { slug: "s", body: "hi", parentCommentId: null },
    });
  });

  it("空 body (trim 後) は明示エラー", async () => {
    const addCommentFn = vi.fn();
    const result = await executeAddCommentAction(addCommentFn, { slug: "s", body: "   \n  " });
    expect(result).toStrictEqual({ ok: false, error: "コメントを入力してください" });
    expect(addCommentFn).not.toHaveBeenCalled();
  });

  it("server throw → ok:false + error", async () => {
    const addCommentFn = vi.fn().mockRejectedValue(new Error("db"));
    expect(await executeAddCommentAction(addCommentFn, { slug: "s", body: "x" })).toStrictEqual({
      ok: false,
      error: "db",
    });
  });

  it("非 Error throw は generic message fallback", async () => {
    const addCommentFn = vi.fn().mockRejectedValue({ weird: true });
    expect(await executeAddCommentAction(addCommentFn, { slug: "s", body: "x" })).toStrictEqual({
      ok: false,
      error: "post failed",
    });
  });

  it("parentCommentId が指定された場合 server fn にそのまま転送", async () => {
    const comment = {
      id: "c2",
      authorName: "x",
      authorId: "u",
      body: "reply",
      createdAt: "2026-01-01",
      parentCommentId: "parent-1",
    };
    const addCommentFn = vi.fn().mockResolvedValue(comment);
    await executeAddCommentAction(addCommentFn, {
      slug: "s",
      body: "reply",
      parentCommentId: "parent-1",
    });
    expect(addCommentFn).toHaveBeenCalledWith({
      data: { slug: "s", body: "reply", parentCommentId: "parent-1" },
    });
  });
});

describe("dispatchLikeClick", () => {
  let setSubmitting: ReturnType<typeof vi.fn>;
  let setError: ReturnType<typeof vi.fn>;
  let setLikes: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    setSubmitting = vi.fn();
    setError = vi.fn();
    setLikes = vi.fn();
  });

  it("auth false: 何もしない (setSubmitting も呼ばない)", async () => {
    await dispatchLikeClick({
      isAuthenticated: false,
      submitting: false,
      toggleLikeFn: vi.fn(),
      slug: "x",
      setSubmitting,
      setError,
      setLikes,
    });
    expect(setSubmitting).not.toHaveBeenCalled();
    expect(setLikes).not.toHaveBeenCalled();
  });

  it("submitting true: 何もしない (二重 submit 防止)", async () => {
    await dispatchLikeClick({
      isAuthenticated: true,
      submitting: true,
      toggleLikeFn: vi.fn(),
      slug: "x",
      setSubmitting,
      setError,
      setLikes,
    });
    expect(setSubmitting).not.toHaveBeenCalled();
  });

  it("ok: setSubmitting(true) → setLikes(next) → setSubmitting(false)", async () => {
    const toggleLikeFn = vi.fn().mockResolvedValue({ liked: true, count: 5 });
    await dispatchLikeClick({
      isAuthenticated: true,
      submitting: false,
      toggleLikeFn,
      slug: "x",
      setSubmitting,
      setError,
      setLikes,
    });
    expect(setSubmitting).toHaveBeenNthCalledWith(1, true);
    expect(setError).toHaveBeenCalledWith(null);
    expect(setLikes).toHaveBeenCalledWith({ liked: true, count: 5 });
    expect(setSubmitting).toHaveBeenNthCalledWith(2, false);
  });

  it("error: setError 経由で message が露出", async () => {
    const toggleLikeFn = vi.fn().mockRejectedValue(new Error("nope"));
    await dispatchLikeClick({
      isAuthenticated: true,
      submitting: false,
      toggleLikeFn,
      slug: "x",
      setSubmitting,
      setError,
      setLikes,
    });
    expect(setError).toHaveBeenLastCalledWith("nope");
    expect(setLikes).not.toHaveBeenCalled();
  });
});

describe("dispatchCommentSubmit", () => {
  let setSubmitting: ReturnType<typeof vi.fn>;
  let setError: ReturnType<typeof vi.fn>;
  let setComments: ReturnType<typeof vi.fn>;
  let setDraft: ReturnType<typeof vi.fn>;
  let invalidate: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    setSubmitting = vi.fn();
    setError = vi.fn();
    setComments = vi.fn();
    setDraft = vi.fn();
    invalidate = vi.fn();
  });

  it("auth false: 何もしない", async () => {
    await dispatchCommentSubmit({
      isAuthenticated: false,
      submitting: false,
      draft: "x",
      addCommentFn: vi.fn(),
      slug: "s",
      comments: [],
      setSubmitting,
      setError,
      setComments,
      setDraft,
      invalidate,
    });
    expect(setSubmitting).not.toHaveBeenCalled();
  });

  it("submitting true: 何もしない", async () => {
    await dispatchCommentSubmit({
      isAuthenticated: true,
      submitting: true,
      draft: "x",
      addCommentFn: vi.fn(),
      slug: "s",
      comments: [],
      setSubmitting,
      setError,
      setComments,
      setDraft,
      invalidate,
    });
    expect(setSubmitting).not.toHaveBeenCalled();
  });

  it("ok: 新コメントを prepend + draft 空 + invalidate", async () => {
    const comment = {
      id: "c3",
      authorName: "x",
      authorId: "u",
      body: "new",
      createdAt: "2026-01-01",
      parentCommentId: null,
    };
    const existing = [{ ...comment, id: "c0" }];
    const addCommentFn = vi.fn().mockResolvedValue(comment);
    await dispatchCommentSubmit({
      isAuthenticated: true,
      submitting: false,
      draft: "new",
      addCommentFn,
      slug: "s",
      comments: existing,
      setSubmitting,
      setError,
      setComments,
      setDraft,
      invalidate,
    });
    expect(setComments).toHaveBeenCalledWith([comment, ...existing]);
    expect(setDraft).toHaveBeenCalledWith("");
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("error: setError + invalidate しない", async () => {
    const addCommentFn = vi.fn().mockRejectedValue(new Error("server fail"));
    await dispatchCommentSubmit({
      isAuthenticated: true,
      submitting: false,
      draft: "x",
      addCommentFn,
      slug: "s",
      comments: [],
      setSubmitting,
      setError,
      setComments,
      setDraft,
      invalidate,
    });
    expect(setError).toHaveBeenLastCalledWith("server fail");
    expect(setComments).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });
});
