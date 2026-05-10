/**
 * `@self/db/schema` — Drizzle schema の barrel export。
 *
 * 各 table と type の SSoT を 1 モジュールから引けるようにする。drizzle-kit が
 * このファイルを `drizzle.config.ts` 経由で参照して migration を生成する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 全 schema (posts / comments / likes / view_counts + Better Auth 4 table) の barrel export。drizzle-kit の generator が glob でなく単一ファイル参照で済むよう re-export を集約する
 * @graph-connects none
 */

export { posts, type NewPost, type Post } from "./posts.js";
export { comments, type Comment, type NewComment } from "./comments.js";
export { likes, type Like, type NewLike } from "./likes.js";
export { viewCounts, type NewViewCount, type ViewCount } from "./view-counts.js";

// Better Auth core schema (user / session / account / verification)
export {
  account,
  session,
  user,
  verification,
  type Account,
  type NewAccount,
  type NewSession,
  type NewUser,
  type NewVerification,
  type Session,
  type User,
  type Verification,
} from "./auth.js";
