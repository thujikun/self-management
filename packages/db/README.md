# @self/db

ryantsuji.dev の Postgres (Neon) schema + client。Drizzle ORM + `@neondatabase/serverless` の **HTTP driver** を使い、CF Workers から TCP socket 不要で叩ける構成。

## カバーする table

| table | 役割 |
|---|---|
| `posts` | markdown 投稿の identity (slug PK)。本文は markdown SSoT 側、ここは comments / likes / view_counts の FK target |
| `comments` | 投稿コメント (cascade FK to `posts.slug`)、認証導入前提の author* field、soft delete。native 投稿に加えて dev.to 取り込み用の source 系 column (`source` / `source_comment_id` / `source_url` / `author_profile_url`) を持ち、`(source, source_comment_id)` の unique index (`comments_source_id_uq`) で冪等 upsert する (取り込み CLI は `scripts/import-devto-comments.ts`、運用手順は `apps/ryantsuji-dev/web/README.md` の「dev.to コメント取り込み」) |
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

`migrate:apply` は **`drizzle-orm/neon-http/migrator`** を使い、`drizzle.__drizzle_migrations` table で履歴を track する形 (再実行 idempotent)。drizzle-kit migrate と同じ tracker 体系で、`drizzle:push` は TTY 必須なので避ける。

### bootstrap: 既存 DB を新 migrator に移行する場合

PR #16 以前に旧 SQL split runner で migration を当てていた DB 上で `migrate:apply` を初回実行すると、`__drizzle_migrations` が無いため `0000` を再 apply しに行き `CREATE TABLE ... already exists` で停止する。1 回限りの bootstrap が必要:

```sql
-- 0000 の hash を tracker に手で seed (drizzle-kit migrate runner と同等の状態に)
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
  id SERIAL PRIMARY KEY,
  hash TEXT NOT NULL,
  created_at BIGINT
);

-- 既存 0000 の hash を migrations/meta/_journal.json から読んで insert
-- 例 (実 hash は journal を参照):
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
VALUES ('<hash from migrations/meta/_journal.json for tag 0000>', extract(epoch from now()) * 1000);
```

その後 `pnpm --filter @self/db migrate:apply` を流すと 0001 以降が incremental に当たる。新 dev branch / CI の DB seed 時は最初から `migrate:apply` だけで済む (空 DB なら全 migration が順次適用される)。

## consumer 側のハマり所: BigInt

`view_counts.count` は `bigint(mode: "bigint")` で返すので **JS BigInt** になる。`JSON.stringify(row)` は `TypeError: Do not know how to serialize a BigInt` を投げるので注意:

```ts
const [vc] = await db.select().from(viewCounts).where(eq(viewCounts.postSlug, slug));

// ❌ TypeError
return JSON.stringify(vc);

// ✅ 文字列化 (大規模 view 想定なら推奨)
return JSON.stringify({ ...vc, count: String(vc.count) });

// ✅ 数値化 (2^53 = 9 × 10^15 を超えない範囲なら OK)
return JSON.stringify({ ...vc, count: Number(vc.count) });
```

bigint mode を選んだ理由は 2^31 (PG int) も 2^53 (JS number) も将来 view 数で踏む可能性を小さくするため。precision を捨てて Number に倒すなら schema 側で `mode: "number"` に変更することも検討可。

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
