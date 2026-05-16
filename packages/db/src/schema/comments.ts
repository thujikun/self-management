/**
 * `comments` table — 投稿に対するコメント。
 *
 * 認証が入る前提 (Better Auth は別 PR)。`authorId` は将来 users テーブルへの FK
 * になるが、本 PR の段階では string にとどめておく (auth スキーマと同 PR で
 * relation 化する)。一時的な匿名運用用に `authorName` / `authorEmail` も持つ。
 *
 * 親 post は `posts.slug` を FK で参照、削除時 cascade で comment も消える。
 *
 * 親 comment への FK (`parent_comment_id`) は `post_slug` 一致を schema 側で
 * 強制しない (DB の declarative FK では single-column のみ)。post 跨ぎ reply /
 * 階層 1 超過の弾きは `server/engagement.ts:addComment` で 1 SELECT して
 * application 層で行う。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business コメント schema。posts への cascade FK + 認証導入前提の author* field を持つ。本文は plain text (markdown render は次の iteration、まず保存と表示)
 * @graph-connects drizzle [provides] comments table の Drizzle schema
 * @graph-connects posts [references] posts.slug を FK target に取り、cascade delete で整合
 */

import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";

import { posts } from "./posts.js";

/** @graph-connects drizzle [provides] post に対するコメント (cascade FK to posts) */
export const comments = pgTable("comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  postSlug: text("post_slug")
    .notNull()
    .references(() => posts.slug, { onDelete: "cascade" }),
  // 認証導入後は users.id (uuid) になる予定。現状は string (anonymous OR provider-id)。
  authorId: text("author_id"),
  authorName: text("author_name").notNull(),
  authorEmail: text("author_email"),
  body: text("body").notNull(),
  // thread 用の親コメント参照。null = top-level、UUID = その親コメント (1 階層のみ)。
  // `ON DELETE CASCADE` は hard delete でのみ発火する。soft delete (deletedAt 更新) は
  // 子 row を残すので、親が soft delete された場合は親不在 reply となり、UI 側
  // (`buildCommentTree`) で top-level に昇格して見える。これは意図した形 (子の内容まで
  // 連動消去するのは過剰)。post 跨ぎ / 階層 1 超過は application 層 (addComment) で弾く。
  parentCommentId: uuid("parent_comment_id").references((): AnyPgColumn => comments.id, {
    onDelete: "cascade",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  // Soft delete: spam / abuse 対応で row は残し UI から消す pattern。自分の comment
  // を削除する UI でもこのカラムに timestamp を書いて hide する。
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/** @graph-connects none */
export type Comment = typeof comments.$inferSelect;
/** @graph-connects none */
export type NewComment = typeof comments.$inferInsert;
