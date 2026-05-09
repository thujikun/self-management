/**
 * `view_counts` table — 投稿ごとの閲覧数 (post slug → counter)。
 *
 * 1 row per post の単純 counter。`UPDATE ... SET count = count + 1 RETURNING *`
 * でアトミックに increment する想定。匿名 view を含む全 view を 1 集計する設計
 * (ユニーク view が必要になったら別 table に dimension を持たせる)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business view counter schema。post 1 件 = 1 row の単純 increment 設計、匿名 / 認証区別なく全 view を加算する。ユニーク view が必要になったら別 dimension table を切る方針 (現段階では小さく入れる)
 * @graph-connects drizzle [provides] view_counts table の Drizzle schema
 * @graph-connects posts [references] posts.slug を primary key + cascade FK で 1:1 化
 */

import { sql } from "drizzle-orm";
import { bigint, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { posts } from "./posts.js";

/** @graph-connects drizzle [provides] post 1 件 = 1 row の view counter */
export const viewCounts = pgTable("view_counts", {
  // posts.slug と 1:1。post が消えたら view counter も消える。
  postSlug: text("post_slug")
    .primaryKey()
    .references(() => posts.slug, { onDelete: "cascade" }),
  // bigint で安全側 (PG int は 2^31)、JS 側は string で受ける (drizzle 既定)。
  count: bigint("count", { mode: "bigint" })
    .notNull()
    .default(sql`0`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

/** @graph-connects none */
export type ViewCount = typeof viewCounts.$inferSelect;
/** @graph-connects none */
export type NewViewCount = typeof viewCounts.$inferInsert;
