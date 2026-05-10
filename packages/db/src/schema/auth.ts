/**
 * Better Auth が要求する core schema (`user` / `session` / `account` / `verification`)。
 *
 * Better Auth の標準 (`docs/concepts/database#core-schema`) に **そのまま追従**:
 * - 各 table 名は単数形 (`user` 等)、column 名は camelCase (`userId` / `expiresAt` 等)
 * - Drizzle adapter (better-auth/adapters/drizzle) はこの命名で動く前提
 * - 値の生成 (id / token / 各 timestamp) は Better Auth runtime 側で行うので、
 *   Drizzle 側は `notNull` を満たす shape だけを宣言する
 *
 * comments / likes / view_counts と異なり、この層は Better Auth が SSoT。schema 変更は
 * Better Auth の version bump に追従する形で行う (独自 column 追加は plugin 経由で別途)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business Better Auth が要求する 4 table の Drizzle schema。table 名は単数形 / column 名は camelCase で Better Auth 標準にそのまま追従。値生成は runtime 側、Drizzle は shape 宣言のみ
 * @graph-connects drizzle [provides] auth 系 4 table の schema
 */

import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** @graph-connects drizzle [provides] users (Better Auth 標準) */
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

/** @graph-connects drizzle [provides] sessions (Better Auth 標準) */
export const session = pgTable("session", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

/** @graph-connects drizzle [provides] accounts (OAuth provider linking) */
export const account = pgTable("account", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  idToken: text("id_token"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

/** @graph-connects drizzle [provides] verification (email / OTP token bag) */
export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

/** @graph-connects none */
export type User = typeof user.$inferSelect;
/** @graph-connects none */
export type NewUser = typeof user.$inferInsert;
/** @graph-connects none */
export type Session = typeof session.$inferSelect;
/** @graph-connects none */
export type NewSession = typeof session.$inferInsert;
/** @graph-connects none */
export type Account = typeof account.$inferSelect;
/** @graph-connects none */
export type NewAccount = typeof account.$inferInsert;
/** @graph-connects none */
export type Verification = typeof verification.$inferSelect;
/** @graph-connects none */
export type NewVerification = typeof verification.$inferInsert;
