# apps/ryantsuji-dev/web

ryantsuji.dev のフロントエンド + API。**TanStack Start (SSR + RSC) + Hono (RPC) on Cloudflare Workers**。

## 中身

- TanStack Router file-based routing (`src/routes/`)
- TanStack Query を root context に同居 (loader / hook で共有 cache)
- Hono を `/api/*` の catch-all に embed (RPC type を `ApiType` として export)
- **RSC 有効化** (`tanstackStart({ rsc: { enabled: true } })` + `@vitejs/plugin-rsc`)。`createServerFn` の handler 経由で server-only logic を rsc env に隔離 (client / ssr bundle に漏れない)
- **markdown は build 時に pre-render** (`vite-plugins/rendered-posts.ts` → `virtual:rendered-posts`)。shiki / unified / remark-* は全 runtime bundle (client / ssr / rsc / worker) から完全に除外され、CF Workers 上では HTML 文字列 lookup のみで済む (Worker CPU 上限 10ms / Error 1102 を構造的に解消)
- **CF Workers binding を `context.env` で型付きアクセス** (`process.env` 経路は廃止)
- 1 CF Worker に SSR + API を統合 (deploy unit を 1 つに)

## ビルド構造

`vite build` は **5 environment** を吐く:

| env | 役割 | 出力 |
|---|---|---|
| api | route 内 API handler | server bundle 内 |
| middleware | TanStack Start middleware | server bundle 内 |
| **rsc** | server component / server function を Flight stream に emit (markdown は build 時 pre-render 済の HTML を lookup のみ) | `dist/server/rsc/` |
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

2. **secret を登録** (12 個 + analytics 用 SA key 1 個)

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
   pnpm exec wrangler secret put OTLP_ENDPOINT             # Grafana Cloud OTLP HTTP endpoint
   pnpm exec wrangler secret put OTLP_AUTH_HEADER          # "Basic <base64(instance:token)>"
   # 自前 analytics 用 (BQ 書き込み権限を持つ SA の JSON key を丸ごと投入)
   gcloud secrets versions access latest --secret=gcp-sa-graph-app-key \
     | pnpm exec wrangler secret put GCP_SA_JSON
   ```

   `GCP_SA_JSON` の SSoT は GCP Secret Manager の `gcp-sa-graph-app-key`
   (graph-app SA の `roles/bigquery.dataEditor` 付き key)。`BQ_PROJECT_ID` /
   `BQ_DATASET` / `BQ_TABLE` は `wrangler.jsonc:vars` 側に平文で書く非 secret
   ID なので、初回 deploy 時に `vars` の方が揃っているか合わせて確認する
   (空のままなら `/api/track` は fail-open で 204 を返し続ける)。

   secret 値は **`gcloud secrets versions access`** で個人 GCP project の secret container
   から取り出して貼る (`docs/guidelines/secrets.md` 参照、SSoT は GCP Secret Manager)。

   `OTLP_ENDPOINT` / `OTLP_AUTH_HEADER` の SSoT は GCP Secret Manager の
   `grafana-otlp-write-token` (auth header) + Grafana Cloud の OTLP HTTP endpoint URL。
   **未投入のまま deploy しても fail-open** で、`server.ts` の OTel 計装が no-op に
   退化するだけで request 自体は通る (preview / 初回 stage 用)。

   なお **`VITE_FARO_COLLECTOR_URL` は wrangler secret ではなく build 時に CI 経由で
   inject される** (`.github/workflows/deploy-ryantsuji-dev.yml:115-123` で
   `gcloud secrets versions access --secret=grafana-faro-collector-url` を実行し、
   `vite build` の env に渡す)。手動 build 時は environment variable で同等に
   `VITE_FARO_COLLECTOR_URL=https://faro-collector-prod-xx.grafana.net/collect`
   を export してから `pnpm build` する。空のままなら client 側の Faro init が
   no-op になり RUM event は送られない (fail-open)。

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

main への merge で **GitHub Actions が自動 deploy** する
(`.github/workflows/deploy-ryantsuji-dev.yml`)。trigger は
`apps/ryantsuji-dev/web/**` / `packages/**` / `pnpm-lock.yaml` の変更。

手動でやりたいときは:

```bash
pnpm run deploy   # build + 本番 deploy。secret は keep される
```

(`pnpm deploy` は pnpm built-in と衝突するので必ず `pnpm run deploy`)

secret を 1 個だけ rotate する場合: `pnpm exec wrangler secret put <NAME>`。
SSoT は GCP Secret Manager なので、値を入れ直したら `gcloud secrets versions access
<id> | pnpm exec wrangler secret put <ENV>` の形で worker 側にも転送する。

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
- **build-time markdown pre-render**: `vite-plugins/rendered-posts.ts` で `content/posts/*.md` を build 時に renderMarkdown → `virtual:rendered-posts` 仮想 module で全 runtime bundle から shiki / unified / remark-* を除去 (Worker upload 7637 → 6489 KiB、CPU 上限 10ms / Error 1102 を構造的に解消)
- **db schema**: `packages/db` (Drizzle + Neon) — posts / comments / likes / view_counts schema
- **auth**: Better Auth (GitHub / X / Google OAuth、open sign-up — 第三者検証は OAuth provider に委ねる)
- **engagement**: `/posts/$slug` に views (+1 per loader call) / likes (toggle、auth 必須) / comments (投稿、auth 必須) を追加

## /posts (多言語)

`/posts` 一覧 + `/posts/$slug` 詳細は **en / ja の bilingual** で配信する。 lang 選択は
以下の優先順:

1. `?lang=en` / `?lang=ja` の query (LangSwitcher の `EN` / `JP` button で切替)
2. `Accept-Language` header から優先言語を推定 (server fn `pickLang`)
3. それ以外は **`en`** に fallback (dev.to import を SoT に揃えたので en は全 post に存在する前提)

### ファイル命名規約

content source は `apps/ryantsuji-dev/web/content/posts/` 配下に置き、
**filename が authoritative**:

```
<slug>.<lang>.md     # e.g. db-graph-mcp.en.md / db-graph-mcp.ja.md
```

- `slug` 部分が同一なら en / ja は同一 post の variant pair として扱われる
- `lang` は `en` / `ja` のみ。frontmatter 側に `slug:` / `lang:` を書いても schema が
  strip するので、ファイル名から導出した値が常に優先される
- `_` prefix slug (e.g. `_minimal-fixture.en.md`) は **`/posts` 一覧から除外** される
  test fixture 用 convention。直接 URL (`/posts/_minimal-fixture`) では引続き reachable
- frontmatter で `draft: true` を立てた variant は listing / 詳細の全経路から除外
- `_zenn-sync-test.ja.md` は **常駐 fixture**: Zenn sync 経路の retest 専用で、Zenn 側にも
  `zenn-sync-test` slug の下書き article が 1 件常駐する前提。`pnpm syndicate:zenn --include-drafts --publish`
  で同じ slug を update し続ける運用 (fixture / Zenn 側 article いずれも削除しない)。
  `syndication.zenn.id` は本来 14 桁 hex (`d416342f46f16b` 等) だが、本 fixture のみ
  grep 容易な placeholder (`zenn-sync-test`) を意図的に採用している

### lang fallback の挙動

- 要求 lang の variant が存在する → 当該 variant を render、`servedLang` は要求 lang
- 要求 lang の variant が無い → **`en` variant に fallback** (en も無い場合は他 lang を
  `SUPPORTED_LANGS` の順で試す)。一覧 card には `(showing EN — JP not available)` の
  hint、詳細 page では `<PostLangSwitcher>` で利用可能 lang のみが button として出る
- ja-only / en-only post も `availableLangs` を見て fallback hint を出すので user に
  「無い言語」を空クリックさせない

### syndication

詳細 page の SoT は本 repo の markdown。後続 PR で **dev.to** (EN) / **Zenn** (JP) に
syndication 投稿し、`canonical_url` を `https://ryantsuji.dev/posts/<slug>` に揃える。

## RPC client

Hono RPC の型は `src/routes/api/$.ts` から export している `ApiType`。
現状 endpoint は **`GET /api/health`** (heartbeat) と **`POST /api/track`**
(自前 analytics の beacon 受け口、fail-open で常に 204) の 2 本。Client 側からは:

```ts
import { hc } from "hono/client";
import type { ApiType } from "~/routes/api/$";

const client = hc<ApiType>("/");
const res = await client.api.health.$get();
const data = await res.json();
```

## 可観測性 (observability)

server / client の両 layer から Grafana Cloud に観測 signal を流す:

- **server (Cloudflare Workers)**: `@microlabs/otel-cf-workers` の `instrument()` で
  `src/server.ts` の Worker entry を wrap。`fetch` span に加えて outbound fetch も
  span 化し、OTLP HTTP で `OTLP_ENDPOINT` (Tempo) に送る。auth は `OTLP_AUTH_HEADER`
  をそのまま header に流す。両 secret が未投入なら **計装そのものを skip** (fail-open)。
- **client (RUM)**: `src/lib/faro-client.ts` の `initFaro` が `@grafana/faro-web-sdk` を
  lazy import で初期化し、page load timing / web-vital / unhandled error / fetch tracing
  を Faro collector に送る。`__root.tsx` の `useEffect` から 1 回だけ起動。
  `VITE_FARO_COLLECTOR_URL` が空なら dynamic import 自体を skip して bundle 解析対象
  からも外れる (fail-open + bundle size 影響なし)。

### 自前 analytics — `/api/track` → BQ `ryan.web_events`

`__root.tsx` の useEffect 内で route 変化を検知して
`src/lib/track-client.ts:trackPageView` を呼び、`navigator.sendBeacon` (失敗時は
`fetch keepalive`) で `POST /api/track` に JSON payload を送る。Worker 側は
`src/routes/api/$.ts` で Hono に委譲、`src/server/bq-track.ts` が
**SA JSON → RS256 JWT 署名 → OAuth2 access token → `tabledata.insertAll`** の経路を
踏んで BQ table `ryan.web_events` に 1 行 streaming insert する (Pulumi で
`infra/core/index.ts` が table / SA を declarative 作成)。

- payload: `path` / `slug` / `lang` / `referrer` / `utm_*` / `viewport_w/h` /
  `locale` / `session_id` (sessionStorage UUID、cookie 不使用、tab close で揮発)
- server 付与: `ts` (server time) / `user_agent` (256 char truncate)
- 必要 env:
  - `GCP_SA_JSON` (secret、SSoT は SecretManager `gcp-sa-graph-app-key`)
  - `BQ_PROJECT_ID` / `BQ_DATASET` / `BQ_TABLE` (`wrangler.jsonc:vars` 側、
    現状 `ryan-self-management` / `ryan` / `web_events`)
- fail-open: SA 未投入 / token exchange 失敗 / `insertAll` 失敗いずれも `/api/track`
  は 204 を返し、server 側で OTel span event `track.bq.fail` を emit するのみ
  (client request は止めない)
- token cache: `getAccessToken` が isolate scope で 1 つ持ち、cold-start 直後の
  並列 request では in-flight Promise を共有して OAuth 経路は 1 回に集約

「BQ にデータが来ない」場合の debug 起点:

1. `pnpm exec wrangler secret list` に `GCP_SA_JSON` が入っているか
2. Tempo の span に `track.bq.fail` event が出ていないか (reason field で
   `parse-sa-json` / `parse-input` / `build-row` / `oauth-or-insert` を区別)
3. BQ console の `ryan.web_events` table preview に直近行が乗っているか

「Tempo / Faro にデータが来ない」場合の debug 起点:

1. Worker secrets に `OTLP_ENDPOINT` / `OTLP_AUTH_HEADER` が入っているか
   (`pnpm exec wrangler secret list`)
2. 直近 deploy 時の `VITE_FARO_COLLECTOR_URL` が build 時に注入されたか
   (Actions log の "Fetch VITE_FARO_COLLECTOR_URL from Secret Manager" step)
3. browser devtools network panel で `faro-collector*` への beacon が出ているか

## 注意点

- `@tanstack/react-start/plugin/vite` の `target: "cloudflare-module"` は v1.167 で plugin schema から削除済。`vite build` は generic SSR bundle (`dist/server/server.js`) を吐き、`server.ts` Worker entry が CF Workers `fetch` shape に wrap する構造
- RSC 経由で server bundle に閉じ込めたい module を import する場合、必ず `createServerFn().handler()` 内で参照する。route file の top-level import は client bundle にも漏れる
