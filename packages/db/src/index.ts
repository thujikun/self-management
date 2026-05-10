/**
 * `@self/db` — ryantsuji.dev の Postgres (Neon) schema + client の barrel。
 *
 * - **app schema**: posts / comments / likes / view_counts (Drizzle 定義)
 * - **auth schema**: user / session / account / verification (Better Auth 標準)
 * - **client**: `createDb(url)` で CF Workers から HTTP 経由で接続
 * - **subpath**: `@self/db/schema` (drizzle-kit 用) と `@self/db/client` (runtime) も別 export
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business `@self/db` の公開 API。app schema (posts/comments/likes/view_counts) と auth schema (user/session/account/verification) と client を 1 module から引けるよう集約。drizzle-kit は subpath `@self/db/schema` を参照、runtime app は `createDb(url)` を呼ぶ
 * @graph-connects none
 */

export {
  account,
  comments,
  likes,
  posts,
  session,
  user,
  verification,
  viewCounts,
  type Account,
  type Comment,
  type Like,
  type NewAccount,
  type NewComment,
  type NewLike,
  type NewPost,
  type NewSession,
  type NewUser,
  type NewVerification,
  type NewViewCount,
  type Post,
  type Session,
  type User,
  type Verification,
  type ViewCount,
} from "./schema/index.js";

export { createDb, type Db } from "./client.js";
