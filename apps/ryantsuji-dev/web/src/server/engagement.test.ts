/**
 * `engagement.ts` の `addComment` 親 row 検証経路の integration test。
 *
 * pure な弾き logic は `engagement-validate.test.ts` が validateReplyParent 単体で
 * 網羅する。本 file は addComment 側で「親 row を 1 SELECT → validateReplyParent」の
 * 配線が正しく走る (= post 跨ぎ / 階層 1 超過 / 親不在を server 層で reject、
 * top-level reply は通す) ことを fake Drizzle chain で確認する回帰 test。
 *
 * coverage 対象外 (engagement.ts は vitest.config の exclude)。本 test は behavioral
 * 回帰防止が目的で、coverage 数値は engagement-validate 側で carry する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business addComment の親 row 検証 wiring (post 跨ぎ reply / 階層 1 超過 / 親不在を reject、top-level reply は通す) を fake Drizzle chain で固定する回帰 test
 * @graph-connects content [calls] addComment を fake db chain 経由で叩く
 */

import { describe, expect, it, vi } from "vitest";

import type { Db } from "@self/db";

import { addComment } from "./engagement.js";

/**
 * Drizzle の select chain (`.select().from().where().limit()` で `await` 解決) を
 * 1 件 SELECT に閉じた最小 fake で再現する factory。`limitResolved` で limit(1) が
 * 解決する値を指定。
 */
function makeSelectChain(limitResolved: unknown[]) {
  const limit = vi.fn().mockResolvedValue(limitResolved);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { select, from, where, limit };
}

/**
 * Drizzle の insert chain (`.insert().values().returning()` で `await` 解決) を
 * 同じく最小 fake で再現する factory。
 */
function makeInsertChain(returningRow: Record<string, unknown>) {
  const returning = vi.fn().mockResolvedValue([returningRow]);
  const values = vi.fn(() => ({ returning }));
  const insert = vi.fn(() => ({ values }));
  return { insert, values, returning };
}

/** insert chain 1 個 (SELECT は呼ばれない = parentCommentId 未指定経路の組み立て用)。 */
function makeInsertOnlyDb(returningRow: Record<string, unknown>): {
  db: Db;
  insertChain: ReturnType<typeof makeInsertChain>;
} {
  const insertChain = makeInsertChain(returningRow);
  return { db: { insert: insertChain.insert } as unknown as Db, insertChain };
}

/** SELECT + INSERT の両 chain を持たせた db (= reply 投稿経路用)。 */
function makeReplyDb(args: { parentRows: unknown[]; insertedRow: Record<string, unknown> }): {
  db: Db;
  selectChain: ReturnType<typeof makeSelectChain>;
  insertChain: ReturnType<typeof makeInsertChain>;
} {
  const selectChain = makeSelectChain(args.parentRows);
  const insertChain = makeInsertChain(args.insertedRow);
  return {
    db: {
      select: selectChain.select,
      insert: insertChain.insert,
    } as unknown as Db,
    selectChain,
    insertChain,
  };
}

const COMMON_ARGS = {
  authorId: "u1",
  authorName: "Ryan",
  authorEmail: "ryan@example.com",
};

describe("addComment — top-level (parentCommentId 不在)", () => {
  it("insert のみ走り、SELECT は呼ばれない", async () => {
    const { db, insertChain } = makeInsertOnlyDb({
      id: "c1",
      authorName: "Ryan",
      authorId: "u1",
      body: "hi",
      createdAt: "2026-05-10T00:00:00.000Z",
      parentCommentId: null,
    });
    const out = await addComment(db, { slug: "p", body: "hi", ...COMMON_ARGS });
    expect(out).toStrictEqual({
      id: "c1",
      authorName: "Ryan",
      authorId: "u1",
      body: "hi",
      createdAt: "2026-05-10T00:00:00.000Z",
      parentCommentId: null,
    });
    expect(insertChain.values).toHaveBeenCalledWith({
      postSlug: "p",
      authorId: "u1",
      authorName: "Ryan",
      authorEmail: "ryan@example.com",
      body: "hi",
      parentCommentId: null,
    });
  });
});

describe("addComment — reply (parentCommentId 指定)", () => {
  it("親が同 slug の top-level → insert に parentCommentId を乗せて通す", async () => {
    const { db, selectChain, insertChain } = makeReplyDb({
      parentRows: [{ postSlug: "p", parentCommentId: null }],
      insertedRow: {
        id: "c2",
        authorName: "Ryan",
        authorId: "u1",
        body: "reply",
        createdAt: "2026-05-10T00:00:00.000Z",
        parentCommentId: "parent-id",
      },
    });
    const out = await addComment(db, {
      slug: "p",
      body: "reply",
      parentCommentId: "parent-id",
      ...COMMON_ARGS,
    });
    expect(out.parentCommentId).toStrictEqual("parent-id");
    expect(selectChain.select).toHaveBeenCalledTimes(1);
    expect(insertChain.values).toHaveBeenCalledWith({
      postSlug: "p",
      authorId: "u1",
      authorName: "Ryan",
      authorEmail: "ryan@example.com",
      body: "reply",
      parentCommentId: "parent-id",
    });
  });

  it("親 row 不在 → INVALID_PARENT_COMMENT throw、insert は呼ばれない", async () => {
    const { db, insertChain } = makeReplyDb({
      parentRows: [],
      insertedRow: { id: "never" },
    });
    await expect(
      addComment(db, {
        slug: "p",
        body: "reply",
        parentCommentId: "missing-id",
        ...COMMON_ARGS,
      }),
    ).rejects.toThrow(/INVALID_PARENT_COMMENT: not found/);
    expect(insertChain.insert).not.toHaveBeenCalled();
  });

  it("親が別 post (post 跨ぎ) → INVALID_PARENT_COMMENT throw、insert は呼ばれない", async () => {
    const { db, insertChain } = makeReplyDb({
      parentRows: [{ postSlug: "other-post", parentCommentId: null }],
      insertedRow: { id: "never" },
    });
    await expect(
      addComment(db, {
        slug: "this-post",
        body: "reply",
        parentCommentId: "parent-of-other-post",
        ...COMMON_ARGS,
      }),
    ).rejects.toThrow(/INVALID_PARENT_COMMENT: post mismatch/);
    expect(insertChain.insert).not.toHaveBeenCalled();
  });

  it("親が既に reply (階層 1 超過) → REPLY_DEPTH_EXCEEDED throw、insert は呼ばれない", async () => {
    const { db, insertChain } = makeReplyDb({
      parentRows: [{ postSlug: "p", parentCommentId: "grandparent-id" }],
      insertedRow: { id: "never" },
    });
    await expect(
      addComment(db, {
        slug: "p",
        body: "reply-to-reply",
        parentCommentId: "reply-id",
        ...COMMON_ARGS,
      }),
    ).rejects.toThrow(/REPLY_DEPTH_EXCEEDED/);
    expect(insertChain.insert).not.toHaveBeenCalled();
  });
});
