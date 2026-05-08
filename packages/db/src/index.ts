/**
 * `@self/db` — ryantsuji.dev の Postgres (Neon) schema + client。
 *
 * 現状は stub。後続 PR で次を埋める想定:
 * - Drizzle schema (`src/schema/`): users, sessions (Better Auth 系), comments, likes, view_counts
 * - Neon HTTP driver / Hyperdrive 接続 wrapper
 * - migration scripts (drizzle-kit)
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 個人ブログの dynamic surface (comment / like / view count / session) を支える Neon Postgres schema の SSoT placeholder。Drizzle + Neon HTTP driver で edge から最短 hop で叩ける構成に倒す
 * @graph-connects none
 */

/** @graph-connects none */
export const DB_SCHEMA_VERSION = "0.0.0-stub";
