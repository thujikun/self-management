/**
 * `likes` table — 投稿への like (👍) と reaction の汎用 entry。
 *
 * 1 (postSlug, identifier, kind) で unique 制約。`identifier` は次のいずれか:
 * - 認証ユーザー: `users.id` (将来)
 * - 匿名ユーザー: 安定した hash (例: cookie + IP + UA を hash した anonymous id)
 *
 * `kind` は `"like"` 単一スタートだが、将来 `"hooray" | "rocket"` 等の reaction を
 * 足せる shape にしておく (GitHub 互換)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business like / reaction schema。(postSlug, identifier, kind) で unique、匿名ユーザーは hash された identifier、認証後は users.id を identifier に使う前提。GitHub 風の reaction 拡張余地を残す
 * @graph-connects drizzle [provides] likes table の Drizzle schema
 * @graph-connects posts [references] posts.slug を cascade FK
 */

import { sql } from "drizzle-orm";
import { pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { posts } from "./posts.js";

/** @graph-connects drizzle [provides] post に対する like / reaction */
export const likes = pgTable(
  "likes",
  {
    postSlug: text("post_slug")
      .notNull()
      .references(() => posts.slug, { onDelete: "cascade" }),
    // 認証ユーザーなら users.id、匿名なら anonymous hash (cookie + UA + IP) を入れる。
    identifier: text("identifier").notNull(),
    // 拡張用: like / hooray / rocket / heart / eyes (GitHub 互換) を後で増やせる shape。
    kind: text("kind").notNull().default("like"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [primaryKey({ columns: [table.postSlug, table.identifier, table.kind] })],
);

/** @graph-connects none */
export type Like = typeof likes.$inferSelect;
/** @graph-connects none */
export type NewLike = typeof likes.$inferInsert;
