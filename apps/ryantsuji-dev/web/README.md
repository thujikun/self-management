# apps/ryantsuji-dev/web

ryantsuji.dev のフロントエンド + API。**TanStack Start (SSR) + Hono (RPC) on Cloudflare Workers**。

## 中身

- TanStack Router file-based routing (`src/routes/`)
- TanStack Query を root context に同居 (loader / hook で共有 cache)
- Hono を `/api/*` の catch-all に embed (RPC type を `ApiType` として export)
- 1 CF Worker に SSR + API を統合 (deploy unit を 1 つに)

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

- **PR 2 (RSC spike)**: `experimental` flag で RSC enable + 1 component を Server Component 化して動作検証
- **PR 3 (design system)**: `packages/design-tokens` で OKLCH ベースの token を定義 → `styles.css` を置換
- **PR 4 (db schema)**: `packages/db` (Drizzle + Neon) で comment / like の schema 定義
- **PR 5 (auth)**: Better Auth で GitHub / Google / Facebook (Apple は v2)
- **PR 6 (content rendering)**: `ryantsuji-dev-content` repo を build-time clone して markdown → 静的 route 生成
- **PR 7 (syndicator)**: dev.to API publish (canonical_url=ryantsuji.dev) + Zenn URL HEAD verify

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

- TanStack Start は v1 安定化中で API が動く可能性あり (特に RSC 関連)。本 bootstrap は SSR ベースのみで、RSC は別 PR の spike 結果次第で enable
- `@tanstack/react-start/plugin/vite` の `target: "cloudflare-module"` が `.output/server/index.mjs` を出力する想定。バージョン差で path 変わったら `wrangler.jsonc` の `main` を合わせる
