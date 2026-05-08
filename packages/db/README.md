# @self/db

ryantsuji.dev の Postgres (Neon) schema + client (現状 stub)。

## 後続 PR で実装

- **Drizzle schema** (`src/schema/`):
  - `users`, `sessions`, `accounts` (Better Auth が要求する table)
  - `comments` (post slug, parent_id, body markdown, author_id, created_at)
  - `likes` (post slug, user_id, unique constraint)
  - `view_counts` (post slug, count) — heavy write は Upstash counter にして batch flush
- **Neon 接続**: `@neondatabase/serverless` + Hyperdrive binding (CF Workers から最短 hop)
- **drizzle-kit migrate**: schema diff から migration 生成、CI で apply

## 設計メモ

- 記事本体は markdown (別 repo `ryantsuji-dev-content`) なので Postgres には乗せない
- view counts のような heavy write は Postgres に直書きしない → Upstash Redis で counter → 定期 flush
- comment / like は moderate write 量なので直 Postgres でよい
- Better Auth の standard schema を尊重する (rename しない)
