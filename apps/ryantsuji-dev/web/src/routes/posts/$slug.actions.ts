/**
 * `/posts/$slug` 用の business logic (like / comment) を React component から分離した
 * pure async function 群。引数で server fn / state setter を受けるので test では
 * vi.fn を渡して状態遷移と side-effect を直接 assert できる。
 *
 * `$slug.tsx` から切り出した理由は単に行数 cap (500 lines) を超えたため。元 file の
 * React component と循環参照しない pure 化された層なので、分離による副作用は無い。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business post detail の like / comment client logic を React component から
 * 切離した pure layer。state setter / server fn を arg で注入し、test 時に vi.fn を
 * 渡して状態遷移と error 経路を直接 assert する。
 * @graph-connects content [calls] toggleLikeFn / addCommentFn (server fn 経由)
 * @graph-connects tanstack-router [calls] router.invalidate でキャッシュ無効化
 */

import type { CommentView } from "../../server/engagement.js";

/**
 * `useServerFn` で得る型を再利用するため一回だけ抽出。test 用 fake にも同 shape を要求できる。
 *
 * @graph-connects none
 */
export type ToggleLikeFn = (args: { data: string }) => Promise<{ liked: boolean; count: number }>;
/** @graph-connects none */
export type AddCommentFn = (args: {
  data: { slug: string; body: string; parentCommentId?: string | null };
}) => Promise<CommentView>;

/**
 * like ボタン押下の business logic。React state を持たず、結果を `{ ok, likes }` /
 * `{ ok, error }` で返す pure な shape にして test 容易に。
 *
 * @graph-connects content [calls] toggleLikeFn (server fn 経由)
 */
export async function executeLikeAction(
  toggleLikeFn: ToggleLikeFn,
  slug: string,
): Promise<{ ok: true; likes: { liked: boolean; count: number } } | { ok: false; error: string }> {
  try {
    const next = await toggleLikeFn({ data: slug });
    return { ok: true, likes: next };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "like failed" };
  }
}

/**
 * comment 投稿の business logic。空 body は明示エラー、server 側 throw も含めて
 * `{ ok, comment }` / `{ ok, error }` に集約。
 *
 * @graph-connects content [calls] addCommentFn (server fn 経由)
 */
export async function executeAddCommentAction(
  addCommentFn: AddCommentFn,
  args: { slug: string; body: string; parentCommentId?: string | null },
): Promise<{ ok: true; comment: CommentView } | { ok: false; error: string }> {
  const trimmed = args.body.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "コメントを入力してください" };
  }
  try {
    const created = await addCommentFn({
      data: { slug: args.slug, body: trimmed, parentCommentId: args.parentCommentId ?? null },
    });
    return { ok: true, comment: created };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "post failed" };
  }
}

/**
 * like ボタンの click handler を「state setters を引数に受け取る」純関数として切出し。
 * React component 側は単に setters を bind して呼ぶだけ。test では vi.fn の setter を渡して
 * 状態遷移と side-effect を直接 assert する。
 *
 * @graph-connects content [calls] executeLikeAction
 */
export async function dispatchLikeClick(deps: {
  isAuthenticated: boolean;
  submitting: boolean;
  toggleLikeFn: ToggleLikeFn;
  slug: string;
  setSubmitting: (v: boolean) => void;
  setError: (e: string | null) => void;
  setLikes: (l: { liked: boolean; count: number }) => void;
}): Promise<void> {
  if (!deps.isAuthenticated || deps.submitting) return;
  deps.setSubmitting(true);
  deps.setError(null);
  const result = await executeLikeAction(deps.toggleLikeFn, deps.slug);
  if (result.ok) {
    deps.setLikes(result.likes);
  } else {
    deps.setError(result.error);
  }
  deps.setSubmitting(false);
}

/**
 * comment 投稿 form の submit handler。`dispatchLikeClick` と同じく setters 注入式。
 * 成功時は draft を空に戻して route loader を invalidate (view count 等の最新化)。
 *
 * @graph-connects content [calls] executeAddCommentAction
 * @graph-connects tanstack-router [calls] router.invalidate でキャッシュ無効化
 */
export async function dispatchCommentSubmit(deps: {
  isAuthenticated: boolean;
  submitting: boolean;
  draft: string;
  addCommentFn: AddCommentFn;
  slug: string;
  comments: CommentView[];
  setSubmitting: (v: boolean) => void;
  setError: (e: string | null) => void;
  setComments: (next: CommentView[]) => void;
  setDraft: (v: string) => void;
  invalidate: () => void;
}): Promise<void> {
  if (!deps.isAuthenticated || deps.submitting) return;
  deps.setSubmitting(true);
  deps.setError(null);
  const result = await executeAddCommentAction(deps.addCommentFn, {
    slug: deps.slug,
    body: deps.draft,
  });
  if (result.ok) {
    deps.setComments([result.comment, ...deps.comments]);
    deps.setDraft("");
    deps.invalidate();
  } else {
    deps.setError(result.error);
  }
  deps.setSubmitting(false);
}
