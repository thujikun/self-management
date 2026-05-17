/**
 * 投稿詳細のコメント一覧 + reply / delete UI。
 *
 * - **threading**: flat list を `parentCommentId` で 1 階層 nest。`null` parent =
 *   top-level、UUID parent = その親への reply。それ以上の深さは作らず、孫は
 *   親と同じ階層に並べる (Twitter スタイルの単純化)。
 * - **reply**: 各 thread の末尾に永続的な reply form (textarea + submit) を出し、
 *   row 横の `[reply]` ボタンはその textarea に focus を移すだけ (form の toggle
 *   は行わない)。投稿時は `onReply({ parentId: root.id, body })` を呼び、reply
 *   先は常に thread root として親 state に append される。
 * - **delete (soft)**: 自分の comment にのみ [delete] button。`onDelete(commentId)`
 *   を呼んで親 state から除外。
 *
 * 認証必須 (未認証 user には reply / delete button + 永続 reply form を出さない)。
 * top-level 投稿用 form は EngagementSection 側、本 component は thread 単位の
 * 永続 reply form を持つ。state は thread ローカル (CommentThread) + 親
 * (EngagementSection) の comments list。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business コメント threading + reply + soft delete UI。flat list を 1 階層 nest し、thread 末尾に永続 reply form を 1 個ずつ持つ。row の [reply] は textarea への focus-only hint で、submit 時は親 commentId 付きで投稿
 * @graph-connects content [calls] addComment / deleteComment server fn を props 経由
 */

"use client";

import { useRef, useState } from "react";

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
  lang,
  onReply,
  onDelete,
}: {
  comments: CommentView[];
  currentUserId: string | null;
  lang?: "en" | "ja";
  onReply: ReplyHandler;
  onDelete: DeleteHandler;
}) {
  const tree = buildCommentTree(comments);
  if (tree.length === 0) {
    return (
      <p className="comments__empty">
        {lang === "ja" ? "まだコメントはありません。" : "no comments yet."}
      </p>
    );
  }
  return (
    <ol className="comments__list">
      {tree.map(({ node, replies }) => (
        <li key={node.id} className="comments__item">
          <CommentThread
            root={node}
            replies={replies}
            currentUserId={currentUserId}
            lang={lang ?? "en"}
            onReply={onReply}
            onDelete={onDelete}
          />
        </li>
      ))}
    </ol>
  );
}

/**
 * 1 thread = top-level comment + 同階層の reply 群 + thread bottom の永続 reply form。
 *
 * UX: 各 thread に textarea が常時表示されるので、ユーザーは「reply ボタンを押す」
 * → 「フォームが現れる」の 2 段階を踏まず、直接書き込める。任意 comment の [reply]
 * ボタンはこの thread bottom の textarea に focus を移すだけ (= 「返信する場所」を
 * 明示するヒント役)。返信は常に thread root (= top-level comment) の子として投稿
 * されるため depth 1 を超えて nest しない (flat thread)。
 *
 * @graph-connects react [provides] single thread with flat replies + persistent reply form
 */
function CommentThread({
  root,
  replies,
  currentUserId,
  lang,
  onReply,
  onDelete,
}: {
  root: CommentView;
  replies: CommentView[];
  currentUserId: string | null;
  lang: "en" | "ja";
  onReply: ReplyHandler;
  onDelete: DeleteHandler;
}) {
  const [replyDraft, setReplyDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const canReply = !!currentUserId;

  const focusReplyBox = () => {
    textareaRef.current?.focus();
    // 一覧下端に form があると見えていない可能性があるので、scroll で寄せる
    textareaRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const r = await onReply({ parentId: root.id, body: replyDraft });
    if (r.ok) {
      setReplyDraft("");
    } else if (r.error) {
      setError(r.error);
    }
    setSubmitting(false);
  };

  const placeholder = lang === "ja" ? "このスレッドに返信" : "reply to this thread";

  return (
    <>
      <CommentRow
        comment={root}
        currentUserId={currentUserId}
        canReply={canReply}
        onRequestReplyFocus={focusReplyBox}
        onDelete={onDelete}
      />
      {replies.length > 0 ? (
        <ol className="comments__replies">
          {replies.map((r) => (
            <li key={r.id} className="comments__item comments__item--reply">
              <CommentRow
                comment={r}
                currentUserId={currentUserId}
                canReply={canReply}
                onRequestReplyFocus={focusReplyBox}
                onDelete={onDelete}
              />
            </li>
          ))}
        </ol>
      ) : null}
      {canReply ? (
        <form className="comments__form comments__form--reply" onSubmit={submit}>
          <label htmlFor={`reply-${root.id}`} className="visually-hidden">
            reply to {root.authorName}
          </label>
          <textarea
            ref={textareaRef}
            id={`reply-${root.id}`}
            className="comments__input"
            value={replyDraft}
            onChange={(e) => setReplyDraft(e.target.value)}
            placeholder={placeholder}
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

/**
 * 1 件のコメント row。author / body + (条件付き) reply / delete ボタン。
 *
 * 「reply」は同 thread bottom の textarea に focus を移すだけ (form を toggle で
 * 開かない)。これにより thread 全体で reply 入口が 1 箇所に集約され、返信に対する
 * 返信も自然に同 thread に flat で並ぶ。
 *
 * @graph-connects react [provides] single comment row with focus-only reply hint + delete
 */
function CommentRow({
  comment,
  currentUserId,
  canReply,
  onRequestReplyFocus,
  onDelete,
}: {
  comment: CommentView;
  currentUserId: string | null;
  canReply: boolean;
  onRequestReplyFocus: () => void;
  onDelete: DeleteHandler;
}) {
  const isOwn = currentUserId !== null && comment.authorId === currentUserId;
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
              <button type="button" className="comments__action" onClick={onRequestReplyFocus}>
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
    </>
  );
}
