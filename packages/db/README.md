# @self/db

ryantsuji.dev の Postgres (Neon) schema + client。Drizzle ORM + `@neondatabase/serverless` の **HTTP driver** を使い、CF Workers から TCP socket 不要で叩ける構成。

## カバーする table

| table | 役割 |
|---|---|
| `posts` | markdown 投稿の identity (slug PK)。本文は markdown SSoT 側、ここは comments / likes / view_counts の FK target |
| `comments` | 投稿コメント (cascade FK to `posts.slug`)、認証導入前提の author* field、soft delete |
| `likes` | post への like / reaction、composite PK `(post_slug, identifier, kind)`、anonymous (cookie hash) と認証ユーザー (users.id) の両方を identifier に取る |
| `view_counts` | 投稿ごとの view counter (1:1 with posts.slug、bigint counter) |

将来追加: `users` / `sessions` / `accounts` (Better Auth 用) は別 PR。

## 使い方

### TypeScript / runtime (CF Workers / Node)

```ts
import { createDb, posts, comments } from "@self/db";

// CF Workers の env.DATABASE_URL を渡す。1 request 1 instance を想定 (lazy fetch)。
const db = createDb(env.DATABASE_URL);

const all = await db.select().from(posts).orderBy(posts.publishedAt);
await db.insert(comments).values({ postSlug: "hello-world", authorName: "ryan", body: "..." });
```

### drizzle-kit (migration / studio)

```bash
# direnv allow で .envrc.local の DATABASE_URL を環境変数に流してから:
pnpm --filter @self/db drizzle:generate   # schema 変更後、migrations/ に SQL 生成
pnpm --filter @self/db migrate:apply      # migrations/*.sql を順次適用 (空 DB / fresh apply 用)
pnpm --filter @self/db drizzle:studio     # ブラウザ UI で row を眺める
```

`drizzle:generate` は `src/schema/index.ts` を起点に diff を取って `migrations/0NNN_*.sql` を吐く。生成 SQL は **commit する** (review 対象)。

`drizzle:push` は TTY 必須なので避け、`migrate:apply` (本リポジトリ独自の SQL runner) で当てる。本格運用に入ったら drizzle-kit の正規 migrate runner に置き換える想定。

## 設計の決め事

- **slug を PK** に。UUID より読みやすく、URL / Zenn / dev.to との突合 key としても素直
- **本文は markdown SSoT** (`apps/ryantsuji-dev/web/content/posts/*.md`)、Postgres には id/title/publishedAt のみ cache
- view counts は **直 Postgres に増分 UPDATE**。次 phase で write が爆発したら Upstash Redis 経由 batch flush に切替
- comment は **soft delete** (`deleted_at`) で row を残す方針 (spam / abuse 対応)
- like は **(post, identifier, kind) で unique**。`kind` は GitHub 互換に拡張余地 (`hooray` / `rocket` 等)
- 認証導入前提の field (`comments.authorId`、`likes.identifier`) は string で受けておき、Better Auth 導入時に users table への FK relation に格上げ

## 環境変数

`DATABASE_URL` (Neon の **pooled** connection string) が必須。

| env | 設定方法 |
|---|---|
| dev | `.envrc.local` に `export DATABASE_URL="postgresql://..."` (gitignore 済) |
| production (CF Workers) | `wrangler secret put DATABASE_URL` |
| 共有 (将来) | GCP Secret Manager に投入 + `.envrc` で `gcloud secrets versions access latest` (Grafana / SA token と同パターン) |

## ファイル構成

```
packages/db/
├── src/
│   ├── schema/
│   │   ├── posts.ts            # 投稿 identity (slug PK)
│   │   ├── comments.ts         # cascade FK to posts
│   │   ├── likes.ts            # composite PK
│   │   ├── view-counts.ts      # 1:1 with posts
│   │   └── index.ts            # barrel (drizzle-kit が schema 起点として参照)
│   ├── client.ts               # createDb(url) - Neon HTTP + Drizzle
│   └── index.ts                # public barrel
├── scripts/apply-migrations.ts # 空 DB / fresh apply 用 SQL runner
├── migrations/                 # drizzle-kit generate の出力 (commit する)
└── drizzle.config.ts           # drizzle-kit 設定
```
