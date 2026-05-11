# apps/ryantsuji-dev/web

ryantsuji.dev のフロントエンド + API。**TanStack Start (SSR + RSC) + Hono (RPC) on Cloudflare Workers**。

## 中身

- TanStack Router file-based routing (`src/routes/`)
- TanStack Query を root context に同居 (loader / hook で共有 cache)
- Hono を `/api/*` の catch-all に embed (RPC type を `ApiType` として export)
- **RSC 有効化** (`tanstackStart({ rsc: { enabled: true } })` + `@vitejs/plugin-rsc`)。`createServerFn` の handler 経由で重 dep (shiki / unified) は **rsc env のみに bundle** され client / ssr bundle に漏れない
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

`server.ts` (Worker entry) は `dist/server/server.js` を import し CF Workers の `fetch(req, env, ctx)` 形式に変換。

## 開発

```bash
# 1. workspace root で deps install
cd ../../..
pnpm install

# 2. dev server
cd apps/ryantsuji-dev/web
pnpm dev          # http://localhost:3000

# 3. CF Workers にデプロイ
pnpm deploy:dry   # build + dry-run (確認)
pnpm deploy       # 本番 deploy (要 wrangler login)
```

初回 deploy で `https://ryantsuji-dev-web.<account>.workers.dev` に publish される。

## カスタムドメイン (`ryantsuji.dev`)

初回 worker deploy 後に、`infra/ryantsuji-dev/` の Pulumi スタック側で
`cloudflare.WorkerCustomDomain` リソースを追加して `ryantsuji.dev` に bind する。

(`wrangler.jsonc` 側に書く方式もあるが、Pulumi で declarative に管理する方が drift しない)

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
- **auth**: Better Auth (GitHub / X OAuth 2.0) + `AUTH_ALLOWED_EMAILS` allowlist
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
