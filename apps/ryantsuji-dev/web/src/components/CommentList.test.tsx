/**
 * CommentList の SSR + DOM 経路 test。
 *
 * - buildCommentTree の 1 階層 nest / 親不在 reply の昇格 / replies の時系列 sort
 * - 空 list / top-level のみ / reply 入り の SSR markup
 * - reply form の open/close、submit で onReply 呼び出し
 * - own comment にだけ delete button が出る、click で onDelete 呼び出し
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business CommentList の threading / reply / delete 経路を網羅。pure な buildCommentTree + DOM interaction (createRoot + happy-dom) で挙動を固定
 * @graph-connects none
 */

import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

import type { CommentView } from "../server/engagement.js";
import { buildCommentTree, CommentList } from "./CommentList.js";

function makeComment(over: Partial<CommentView> & Pick<CommentView, "id">): CommentView {
  return {
    id: over.id,
    authorName: over.authorName ?? "Alice",
    authorId: over.authorId ?? "u1",
    body: over.body ?? "hello",
    createdAt: over.createdAt ?? "2026-05-10T00:00:00Z",
    parentCommentId: over.parentCommentId ?? null,
    source: over.source ?? "native",
    sourceUrl: over.sourceUrl ?? null,
    authorProfileUrl: over.authorProfileUrl ?? null,
  };
}

describe("buildCommentTree", () => {
  it("空配列なら空配列", () => {
    expect(buildCommentTree([])).toStrictEqual([]);
  });

  it("top-level のみは入力順", () => {
    const a = makeComment({ id: "a", createdAt: "2026-05-10T00:00:00Z" });
    const b = makeComment({ id: "b", createdAt: "2026-05-09T00:00:00Z" });
    expect(buildCommentTree([a, b]).map((n) => n.node.id)).toStrictEqual(["a", "b"]);
  });

  it("reply は親の下に時系列 asc で入る", () => {
    const top = makeComment({ id: "top", createdAt: "2026-05-10T00:00:00Z" });
    const r1 = makeComment({ id: "r1", parentCommentId: "top", createdAt: "2026-05-11T00:00:00Z" });
    const r2 = makeComment({ id: "r2", parentCommentId: "top", createdAt: "2026-05-12T00:00:00Z" });
    // 入力は newest-first だが reply は asc に並べ替わる
    const tree = buildCommentTree([r2, r1, top]);
    expect(tree).toHaveLength(1);
    expect(tree[0].node.id).toBe("top");
    expect(tree[0].replies.map((r) => r.id)).toStrictEqual(["r1", "r2"]);
  });

  it("親不在の reply (削除済 parent) は top-level に昇格", () => {
    const orphan = makeComment({ id: "o", parentCommentId: "missing" });
    const tree = buildCommentTree([orphan]);
    expect(tree).toHaveLength(1);
    expect(tree[0].node.id).toBe("o");
    expect(tree[0].replies).toStrictEqual([]);
  });
});

describe("CommentList SSR", () => {
  it("空 list で empty placeholder を出す (lang default = en)", () => {
    const html = renderToString(
      <CommentList
        comments={[]}
        currentUserId={null}
        onReply={async () => ({ ok: true })}
        onDelete={async () => {}}
      />,
    );
    expect(html).toMatch(/no comments yet/);
  });

  it("lang=ja を渡すと placeholder も日本語", () => {
    const html = renderToString(
      <CommentList
        comments={[]}
        currentUserId={null}
        lang="ja"
        onReply={async () => ({ ok: true })}
        onDelete={async () => {}}
      />,
    );
    expect(html).toMatch(/まだコメントはありません/);
  });

  it("top-level + reply の構造を render", () => {
    const top = makeComment({ id: "top", authorName: "A", body: "top body" });
    const reply = makeComment({
      id: "r1",
      authorName: "B",
      body: "reply body",
      parentCommentId: "top",
    });
    const html = renderToString(
      <CommentList
        comments={[top, reply]}
        currentUserId={null}
        onReply={async () => ({ ok: true })}
        onDelete={async () => {}}
      />,
    );
    expect(html).toMatch(/comments__author">A</);
    expect(html).toMatch(/comments__author">B</);
    expect(html).toMatch(/comments__replies/);
    expect(html).toMatch(/comments__item--reply/);
    // 未認証なので reply / delete button は出ない
    expect(html).not.toMatch(/comments__action/);
  });

  it("取り込みコメントは author を profile へリンクし via バッジ + 原文リンクを出す", () => {
    const imported = makeComment({
      id: "imp",
      authorName: "Vinicius",
      body: "great post",
      source: "devto", // DB に入る識別子。表示は "dev.to" に整えられる
      sourceUrl: "https://dev.to/x/comment/abc",
      authorProfileUrl: "https://dev.to/vini",
    });
    const html = renderToString(
      <CommentList
        comments={[imported]}
        currentUserId={null}
        onReply={async () => ({ ok: true })}
        onDelete={async () => {}}
      />,
    );
    // author 名は profile へのリンク (class + href が同じ <a> に乗る)
    expect(html).toMatch(/<a class="comments__author" href="https:\/\/dev\.to\/vini"/);
    // via バッジは source 名 + 原文 deep link
    expect(html).toMatch(/comments__source-badge/);
    expect(html).toMatch(/href="https:\/\/dev\.to\/x\/comment\/abc"/);
    // React は静的 text と式の境界に `<!-- -->` を差し込むため間隔を許容
    expect(html).toMatch(/via <!-- -->dev\.to</);
  });

  it("native コメントは via バッジも author リンクも出さない", () => {
    const native = makeComment({ id: "n", authorName: "Local" });
    const html = renderToString(
      <CommentList
        comments={[native]}
        currentUserId={null}
        onReply={async () => ({ ok: true })}
        onDelete={async () => {}}
      />,
    );
    expect(html).not.toMatch(/comments__source-badge/);
    // author は plain span (リンクではない)
    expect(html).toMatch(/<span class="comments__author">Local</);
  });

  it("認証済み + 自分の comment に delete / reply button を出す", () => {
    const own = makeComment({ id: "o", authorId: "me", authorName: "Me" });
    const other = makeComment({ id: "x", authorId: "other", authorName: "Other" });
    const html = renderToString(
      <CommentList
        comments={[own, other]}
        currentUserId="me"
        onReply={async () => ({ ok: true })}
        onDelete={async () => {}}
      />,
    );
    // delete button は own only
    expect((html.match(/comments__action--danger/g) ?? []).length).toBe(1);
    // reply hint button (focus-only) は両 top-level に出る (canReply は currentUserId 有無のみ)
    expect((html.match(/class="comments__action">reply</g) ?? []).length).toBe(2);
    // 各 thread bottom に永続的な reply form が並ぶ (= top-level 数だけ form がある)
    expect((html.match(/comments__form--reply/g) ?? []).length).toBe(2);
  });
});

describe("CommentList DOM interaction (happy-dom)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
  });

  function mount(props: React.ComponentProps<typeof CommentList>) {
    act(() => {
      root = createRoot(container);
      root.render(<CommentList {...props} />);
    });
  }

  it("reply hint button click で textarea に focus、submit で onReply が呼ばれる", async () => {
    const onReply = vi.fn().mockResolvedValue({ ok: true });
    mount({
      comments: [makeComment({ id: "top" })],
      currentUserId: "me",
      onReply,
      onDelete: async () => {},
    });
    // 永続 reply form が初期から存在する
    const form = container.querySelector(".comments__form--reply");
    expect(form).toBeTruthy();
    // reply ボタン (header の hint) を click → textarea に focus が移る
    const replyBtn = container.querySelector(".comments__action") as HTMLButtonElement;
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    act(() => replyBtn.click());
    expect(document.activeElement).toBe(textarea);
    // body を埋めて submit
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(textarea, "reply body");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const submit = container.querySelector(".comments__submit") as HTMLButtonElement;
    await act(async () => submit.click());
    expect(onReply).toHaveBeenCalledWith({ parentId: "top", body: "reply body" });
  });

  it("空 textarea で submit button は disabled", async () => {
    const onReply = vi.fn().mockResolvedValue({ ok: true });
    mount({
      comments: [makeComment({ id: "top" })],
      currentUserId: "me",
      onReply,
      onDelete: async () => {},
    });
    const submit = container.querySelector(".comments__submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it("onReply が error を返したら form 内に error 表示", async () => {
    const onReply = vi.fn().mockResolvedValue({ ok: false, error: "server boom" });
    mount({
      comments: [makeComment({ id: "top" })],
      currentUserId: "me",
      onReply,
      onDelete: async () => {},
    });
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(textarea, "x");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      (container.querySelector(".comments__submit") as HTMLButtonElement).click();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("server boom");
  });

  it("delete button click で onDelete が commentId 付きで呼ばれる", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    mount({
      comments: [makeComment({ id: "own", authorId: "me" })],
      currentUserId: "me",
      onReply: async () => ({ ok: true }),
      onDelete,
    });
    const deleteBtn = container.querySelector(".comments__action--danger") as HTMLButtonElement;
    await act(async () => deleteBtn.click());
    expect(onDelete).toHaveBeenCalledWith("own");
  });
});
