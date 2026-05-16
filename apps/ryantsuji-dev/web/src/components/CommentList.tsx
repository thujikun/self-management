/**
 * 投稿詳細のコメント一覧 + reply / delete UI。
 *
 * - **threading**: flat list を `parentCommentId` で 1 階層 nest。`null` parent =
 *   top-level、UUID parent = その親への reply。それ以上の深さは作らず、孫は
 *   親と同じ階層に並べる (Twitter スタイルの単純化)。
 * - **reply**: 各 comment 下に [reply] toggle → inline form。投稿時は
 *   `onReply({ parentId, body })` を呼び、結果は親 state で append される。
 * - **delete (soft)**: 自分の comment にのみ [delete] button。`onDelete(commentId)`
 *   を呼んで親 state から除外。
 *
 * 認証必須 (未認証 user には reply / delete button は出さない)。投稿 form は
 * EngagementSection 側に top-level 用 1 個、本 component に reply 用 inline 1 個。
 * state は親 (EngagementSection) 管理、本 component は controlled な list view。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business コメント threading + reply + soft delete UI。flat list を 1 階層 nest し、user 自身の comment にだけ delete を出す。reply は inline form で親 commentId を持たせて投稿
 * @graph-connects content [calls] addComment / deleteComment server fn を props 経由
 */

"use client";

import { useState } from "react";

import type { CommentView } from "../server/engagement.js";

/** @graph-connects none */
export interface ReplyHandler {
  (args: { parentId: string; body: string }): Promise<{ ok: boolean; error?: string }>;
}

/** @graph-connects none */
export interface DeleteHandler {
  (commentId: string): Promise<void>;
}

/**
 * flat comment list を `parentCommentId` で 1 階層に group する pure 関数。
 *
 * top-level 群を入力順 (= newest first) で並べ、各 top-level に子 reply を入れる。
 * reply は createdAt 古→新 (= 上から時系列で読める) に並べ替えて入れる。
 * 親不在の reply (削除済 parent 等) は top-level に昇格して見せる。
 *
 * @graph-connects none
 */
export function buildCommentTree(
  flat: CommentView[],
): { node: CommentView; replies: CommentView[] }[] {
  const byId = new Map<string, CommentView>();
  for (const c of flat) byId.set(c.id, c);
  const topLevel: CommentView[] = [];
  const repliesByParent = new Map<string, CommentView[]>();
  for (const c of flat) {
    if (c.parentCommentId && byId.has(c.parentCommentId)) {
      const arr = repliesByParent.get(c.parentCommentId) ?? [];
      arr.push(c);
      repliesByParent.set(c.parentCommentId, arr);
    } else {
      topLevel.push(c);
    }
  }
  return topLevel.map((node) => ({
    node,
    replies: (repliesByParent.get(node.id) ?? [])
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  }));
}

/** @graph-connects react [provides] threaded comment list */
export function CommentList({
  comments,
  currentUserId,
  onReply,
  onDelete,
}: {
  comments: CommentView[];
  currentUserId: string | null;
  onReply: ReplyHandler;
  onDelete: DeleteHandler;
}) {
  const tree = buildCommentTree(comments);
  if (tree.length === 0) {
    return <p className="comments__empty">まだコメントはありません。</p>;
  }
  return (
    <ol className="comments__list">
      {tree.map(({ node, replies }) => (
        <li key={node.id} className="comments__item">
          <CommentRow
            comment={node}
            currentUserId={currentUserId}
            canReply={!!currentUserId}
            onReply={onReply}
            onDelete={onDelete}
          />
          {replies.length > 0 ? (
            <ol className="comments__replies">
              {replies.map((r) => (
                <li key={r.id} className="comments__item comments__item--reply">
                  <CommentRow
                    comment={r}
                    currentUserId={currentUserId}
                    canReply={false}
                    onReply={onReply}
                    onDelete={onDelete}
                  />
                </li>
              ))}
            </ol>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/**
 * 1 件のコメント row。author / body + (条件付き) reply form + delete button。
 *
 * @graph-connects react [provides] single comment row with inline reply / delete
 */
function CommentRow({
  comment,
  currentUserId,
  canReply,
  onReply,
  onDelete,
}: {
  comment: CommentView;
  currentUserId: string | null;
  canReply: boolean;
  onReply: ReplyHandler;
  onDelete: DeleteHandler;
}) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyDraft, setReplyDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOwn = currentUserId !== null && comment.authorId === currentUserId;

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const r = await onReply({ parentId: comment.id, body: replyDraft });
    if (r.ok) {
      setReplyDraft("");
      setReplyOpen(false);
    } else if (r.error) {
      setError(r.error);
    }
    setSubmitting(false);
  };

  const showActions = canReply || isOwn;
  return (
    <>
      <header className="comments__meta">
        <span className="comments__author">{comment.authorName}</span>
        <time dateTime={comment.createdAt} className="comments__date">
          {comment.createdAt.slice(0, 10)}
        </time>
        {showActions ? (
          <div className="comments__actions">
            {canReply ? (
              <button
                type="button"
                className="comments__action"
                onClick={() => setReplyOpen((v) => !v)}
                aria-expanded={replyOpen}
              >
                reply
              </button>
            ) : null}
            {isOwn ? (
              <button
                type="button"
                className="comments__action comments__action--danger"
                onClick={() => void onDelete(comment.id)}
                aria-label="delete this comment"
              >
                delete
              </button>
            ) : null}
          </div>
        ) : null}
      </header>
      <p className="comments__body">{comment.body}</p>
      {replyOpen ? (
        <form className="comments__form comments__form--reply" onSubmit={submit}>
          <label htmlFor={`reply-${comment.id}`} className="visually-hidden">
            reply to {comment.authorName}
          </label>
          <textarea
            id={`reply-${comment.id}`}
            className="comments__input"
            value={replyDraft}
            onChange={(e) => setReplyDraft(e.target.value)}
            placeholder="返信を書いてください"
            rows={2}
            maxLength={4000}
            disabled={submitting}
          />
          <button
            type="submit"
            className="comments__submit"
            disabled={submitting || replyDraft.trim().length === 0}
          >
            {submitting ? "posting..." : "reply"}
          </button>
          {error ? (
            <p className="comments__error" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
    </>
  );
}
