/**
 * `@self/db` — ryantsuji.dev の Postgres (Neon) schema + client の barrel。
 *
 * - **schema**: posts / comments / likes / view_counts (Drizzle 定義)
 * - **client**: `createDb(url)` で CF Workers から HTTP 経由で接続
 * - **subpath**: `@self/db/schema` (drizzle-kit 用) と `@self/db/client` (runtime) も別 export
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business `@self/db` の公開 API。schema / client を 1 module から引けるよう集約。drizzle-kit は subpath `@self/db/schema` を参照、runtime app は `createDb(url)` を呼ぶ
 * @graph-connects none
 */

export {
  posts,
  comments,
  likes,
  viewCounts,
  type Comment,
  type Like,
  type NewComment,
  type NewLike,
  type NewPost,
  type NewViewCount,
  type Post,
  type ViewCount,
} from "./schema/index.js";

export { createDb, type Db } from "./client.js";
