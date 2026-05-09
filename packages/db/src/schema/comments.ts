/**
 * `comments` table — 投稿に対するコメント。
 *
 * 認証が入る前提 (Better Auth は別 PR)。`authorId` は将来 users テーブルへの FK
 * になるが、本 PR の段階では string にとどめておく (auth スキーマと同 PR で
 * relation 化する)。一時的な匿名運用用に `authorName` / `authorEmail` も持つ。
 *
 * 親 post は `posts.slug` を FK で参照、削除時 cascade で comment も消える。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business コメント schema。posts への cascade FK + 認証導入前提の author* field を持つ。本文は plain text (markdown render は次の iteration、まず保存と表示)
 * @graph-connects drizzle [provides] comments table の Drizzle schema
 * @graph-connects posts [references] posts.slug を FK target に取り、cascade delete で整合
 */

import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  // Soft delete: spam / abuse 対応で row は残し UI から消す pattern を取る予定。
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/** @graph-connects none */
export type Comment = typeof comments.$inferSelect;
/** @graph-connects none */
export type NewComment = typeof comments.$inferInsert;
