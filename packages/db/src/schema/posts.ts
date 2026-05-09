/**
 * `posts` table — markdown 投稿の identity (comments / likes / view_counts が
 * FK で参照する受け皿)。
 *
 * 本文は markdown SSoT (`@self/content` + `apps/ryantsuji-dev/web/content/posts/`)
 * 側で管理し、本テーブルは **ID + slug + title cache + first_seen_at** の最小集合。
 * post を一覧する route loader が build-time に upsert する想定 (詳細は別 PR)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business posts は markdown 投稿の identity を Postgres 側に固定するための受け皿。本文は markdown SSoT 側、Postgres は comments / likes / view_counts の FK target としてのみ機能する分離設計
 * @graph-connects drizzle [provides] posts table の Drizzle schema
 */

import { sql } from "drizzle-orm";
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** @graph-connects drizzle [provides] markdown 投稿の identity */
export const posts = pgTable("posts", {
  // slug を primary key として使う (markdown frontmatter の `slug` field と 1:1)。
  // UUID よりも human-readable で URL と直結、外部 syndication (Zenn / dev.to) との
  // 突合 key としても素直。
  slug: text("slug").primaryKey(),
  title: text("title").notNull(),
  // 投稿日時 (frontmatter `publishedAt` のキャッシュ)。検索 / sort 用。
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  // posts table 側に最初に登場した時刻 (DB row 作成日時)。markdown deploy 履歴の参考。
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

/** @graph-connects none */
export type Post = typeof posts.$inferSelect;
/** @graph-connects none */
export type NewPost = typeof posts.$inferInsert;
