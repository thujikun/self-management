# apps/ryantsuji-dev/web

ryantsuji.dev のフロントエンド + API。**TanStack Start (SSR + RSC) + Hono (RPC) on Cloudflare Workers**。

## 中身

- TanStack Router file-based routing (`src/routes/`)
- TanStack Query を root context に同居 (loader / hook で共有 cache)
- Hono を `/api/*` の catch-all に embed (RPC type を `ApiType` として export)
- **RSC 有効化** (`tanstackStart({ rsc: { enabled: true } })` + `@vitejs/plugin-rsc`)。`createServerFn` の handler 経由で重 dep (shiki / unified) は **rsc env のみに bundle** され client / ssr bundle に漏れない
- **CF Workers binding を `context.env` で型付きアクセス** (`process.env` 経路は廃止)
- 1 CF Worker に SSR + API を統合 (deploy unit を 1 つに)

## ビルド構造

`vite build` は **5 environment** を吐く:

| env | 役割 | 出力 |
|---|---|---|
| api | route 内 API handler | server bundle 内 |
| middleware | TanStack Start middleware | server bundle 内 |
| **rsc** | server component / server function を Flight stream に emit | `dist/server/rsc/` |
| client | hydration + flight stream consumer | `dist/client/` |
| ssr | initial HTML render (client bundle と同 input) | `dist/server/` |

`@cloudflare/vite-plugin` が ssr environment を Worker module に変換し、`wrangler.jsonc:main`
で指す `src/server.ts` (本 app 固有 Worker entry) が `(req, env, ctx)` を TanStack Start
handler の `requestContext` に forward する。

## env binding (CF Workers)

`src/start.ts` で `Register['server']['requestContext']` を `{ env: Env; ctx: ExecutionContext }`
に augment。各 server fn / route handler から `context.env.<BINDING>` で型付きアクセス。

```ts
// 例: api/auth route
export function authHandler({ request, context }: { request: Request; context: { env: Env } }) {
  return getAuth(context.env).handler(request);
}

// 例: posts/$slug の createServerFn
const loadEngagementServer = createServerFn()
  .inputValidator(...)
  .handler(async ({ data, context }) => runLoadEngagement(context.env, data));
```

dev 環境 (`vite dev`) では `@cloudflare/vite-plugin` が `.dev.vars` を `env` に inject。
production (Workers) では `wrangler secret put` で設定した secret + `wrangler.jsonc:vars` が
`env` に入る。

## 開発

```bash
# 1. workspace root で deps install
cd ../../..
pnpm install

# 2. .dev.vars に dev 用 env を書く (gitignore 済)
cd apps/ryantsuji-dev/web
cat > .dev.vars <<EOF
DATABASE_URL=postgresql://...
BETTER_AUTH_SECRET=$(openssl rand -hex 32)
BETTER_AUTH_URL=http://localhost:3000
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
X_OAUTH2_CLIENT_ID=...
X_OAUTH2_CLIENT_SECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
APPLE_CLIENT_ID=...
APPLE_CLIENT_SECRET=...
FACEBOOK_CLIENT_ID=...
FACEBOOK_CLIENT_SECRET=...
EOF

# 3. dev server
pnpm dev          # http://localhost:3000

# 4. build + dry-run
pnpm deploy:dry
```

## 本番 deploy 手順 (初回)

1. **wrangler login** (1 度だけ)

   ```bash
   pnpm exec wrangler login
   ```

2. **secret を登録** (13 個)

   ```bash
   cd apps/ryantsuji-dev/web
   pnpm exec wrangler secret put DATABASE_URL              # Neon pooled URL
   pnpm exec wrangler secret put BETTER_AUTH_SECRET        # openssl rand -hex 32
   pnpm exec wrangler secret put BETTER_AUTH_URL           # https://ryantsuji.dev
   pnpm exec wrangler secret put GITHUB_CLIENT_ID
   pnpm exec wrangler secret put GITHUB_CLIENT_SECRET
   pnpm exec wrangler secret put X_OAUTH2_CLIENT_ID
   pnpm exec wrangler secret put X_OAUTH2_CLIENT_SECRET
   pnpm exec wrangler secret put GOOGLE_CLIENT_ID
   pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET
   pnpm exec wrangler secret put APPLE_CLIENT_ID
   pnpm exec wrangler secret put APPLE_CLIENT_SECRET
   pnpm exec wrangler secret put FACEBOOK_CLIENT_ID
   pnpm exec wrangler secret put FACEBOOK_CLIENT_SECRET
   ```

   secret 値は **`gcloud secrets versions access`** で個人 GCP project の secret container
   から取り出して貼る (`docs/guidelines/secrets.md` 参照、SSoT は GCP Secret Manager)。

3. **dry-run でビルド成功 + binding を確認**

   ```bash
   pnpm deploy:dry   # 出力に env.ASSETS / secret list が並ぶこと
   ```

4. **初回 deploy** (workers.dev preview に publish)

   ```bash
   pnpm deploy
   ```

   `https://ryantsuji-dev-web.<account>.workers.dev` に上がる。`/sign-in` で OAuth →
   `/account` → `/posts/<slug>` で view +1 / like / comment を手動 smoke。

5. **カスタムドメイン bind** (deploy 成功後、Pulumi 経由)

   ```bash
   cd ../../../infra/ryantsuji-dev
   # index.ts に cloudflare.WorkerCustomDomain (ryantsuji.dev + www) を追加
   pnpm exec pulumi up
   ```

6. **`wrangler.jsonc:routes`** で apex / www の custom_domain を有効化 (上記 Pulumi で
   override 不可なら wrangler 側に書く、現状は **wrangler 側に既に記述**)

## 通常運用 (2 回目以降)

```bash
pnpm deploy       # build + 本番 deploy。secret は keep される
```

secret を 1 個だけ rotate する場合: `pnpm exec wrangler secret put <NAME>`。

## 後続 PR

- **PR (syndicator)**: dev.to API publish (canonical_url=ryantsuji.dev) + Zenn URL HEAD verify
- **OG image / RSS feed / sitemap**: SEO 系
- **Phase 1 design discovery**: design tokens の OKLCH 値再調整

完了済 (履歴は git log と各 PR description):
- bootstrap: TanStack Start + Hono + Pulumi zone
- RSC spike: `docs/spike/rsc.md` に動作検証 record
- design tokens: `@self/design-tokens` (OKLCH + glass morphism)
- content: `@self/content` (markdown render pipeline)
- /posts: 投稿一覧 + 詳細 route + content/posts/*.md 統合
- **RSC isolation: shiki / unified を rsc env に閉じ込め client bundle 540KB 化**
- **db schema**: `packages/db` (Drizzle + Neon) — posts / comments / likes / view_counts schema
- **auth**: Better Auth (GitHub / X / Google / Apple / Facebook OAuth、open sign-up — 第三者検証は OAuth provider に委ねる)
- **engagement**: `/posts/$slug` に views (+1 per loader call) / likes (toggle、auth 必須) / comments (投稿、auth 必須) を追加

## RPC client

Hono RPC の型は `src/routes/api/$.ts` から export している `ApiType`。
Client 側からは:

```ts
import { hc } from "hono/client";
import type { ApiType } from "~/routes/api/$";

const client = hc<ApiType>("/");
const res = await client.api.health.$get();
const data = await res.json();
```

## 注意点

- `@tanstack/react-start/plugin/vite` の `target: "cloudflare-module"` は v1.167 で plugin schema から削除済。`vite build` は generic SSR bundle (`dist/server/server.js`) を吐き、`server.ts` Worker entry が CF Workers `fetch` shape に wrap する構造
- RSC 経由で server bundle に閉じ込めたい module を import する場合、必ず `createServerFn().handler()` 内で参照する。route file の top-level import は client bundle にも漏れる
