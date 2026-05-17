# アーキテクチャ・設計パターン

個人 1 人運用 + ryan-product-graph + ryantsuji-dev (個人ブログ) を前提に、Composable Architecture を適用する。

## 根本思想: Composable Architecture

**「小さな機能単位を設計し、それらを組み合わせる」** Composable を採用。

- `packages/` に**再利用可能な部品**を配置 (BQ / embedding wrapper、graph schema、design tokens、共通型)
- `apps/` の各サービスは `packages/` を組み合わせて構成
- `infra/` は Pulumi スタック (1 stack = 1 deploy unit + その依存リソース)
- `apps/` 同士の直接 import は禁止 — 必ず `packages/` 経由

**レビューチェック:**

- [ ] 新ロジックは適切な粒度の「部品」として切り出されているか (1 ファイル 1 責務)
- [ ] 既存 `packages/` を再利用しているか (車輪の再発明をしていないか)
- [ ] アプリ固有ロジックと共有可能ロジックが分離されているか
- [ ] `packages/` への切り出し判断: 2 つ以上の app で使う or 使う可能性があるなら `packages/` へ
- [ ] `apps/` 間の直接 import (`../../apps/other/`) が無いか
- [ ] 1 ファイルのコード行が 500 行以下か (CLAUDE.md rule 4、`scripts/hooks/check-line-count.ts` で機械強制)

## 現在のスタック構成

| stack | 役割 | 含まれるもの |
|-------|------|-------------|
| `core` | 個人プロジェクトの基盤 | BQ dataset (`ryan`)、graph SA、IAM、Grafana stack、Secret Manager |
| `ryan-product-graph` | (将来) MCP server / Cloud Run job | 現状 `.gitkeep` のみ、後続 PR で実装 |
| `ryantsuji-dev` | 個人ブログ ryantsuji.dev | CF zone reference、(将来) WorkerCustomDomain |

`scripts/hooks/check-graph-tags.ts` の `STACKS` enum がこのリストの SSoT。新規 stack 追加時は enum 先更新。

## アプリタイプ別パターン

### graph (`apps/graph/product/`)

ryan-product-graph の build / migration / ingest 担当。

- `src/schema/`: TypeScript で node / edge type と BQ table schema を定義 (SSoT)
- `src/parsers/`: 各種 source (markdown / X API / Zenn / dev.to) からノード抽出
- `src/edge-detectors/`: ノード間のエッジ推定・生成
- `src/generators/`: AI 生成 summary 等
- `src/migrate/`: 既存 markdown → BQ 一括移行
- `scripts/init-bq.ts`: BQ table 作成 (idempotent)
- `scripts/build-graph.ts`: 全体ビルド orchestrator

ファイル先頭タグの典型: `@graph-stack ryan-product-graph` / `@graph-domain graph`。

### mcp (`apps/mcp/`)

(将来) MCP server を配置。`mcp-ryan-product-graph-server` が最初の予定。Cloud Run でホスト、`infra/ryan-product-graph/` で provision。

### xmcp (`apps/xmcp/`)

X (Twitter) との API 連携。CLAUDE.md rule 8 に従い、過去 post / 関係性検索は使わず、投稿実行 / 直近 mentions / 投稿後 id 取得などコスト発生が必須なものに限る。

### ryantsuji-dev (`apps/ryantsuji-dev/web/`)

個人ブログ ryantsuji.dev のフロントエンド + API。TanStack Start (SSR) + Hono RPC を 1 CF Worker に統合。

- `src/routes/`: file-based routing (TanStack Router)
- `src/routes/api/$.ts`: `/api/*` catch-all を Hono に委譲、`ApiType` を export して RPC 型共有
- `src/router.tsx`: `getRouter()` (TanStack Start v1.167+ の virtual module convention)
- `src/routeTree.gen.ts`: 自動生成、gitignore 済
- `vite.config.ts`: TanStack Start vite plugin
- `wrangler.jsonc`: CF Workers config (custom_domain で `ryantsuji.dev` / `www.ryantsuji.dev` bind)

ファイル先頭タグの典型: `@graph-stack ryantsuji-dev` / `@graph-domain publishing`。

## 共有パッケージ (`packages/`)

| 命名パターン | 役割 | 現存 |
|-------------|------|------|
| `embedding` | Vertex AI 経由の embedding 生成 wrapper | ✓ |
| `otel` | OpenTelemetry セットアップ | ✓ |
| `db` | Drizzle + Neon schema (ryantsuji-dev 用、後続 PR で実装) | stub |
| `design-tokens` | OKLCH ベース design token (Phase 1 で実装) | stub |
| `domain-*` (将来) | ドメインロジック | - |
| `infra-*` (将来) | インフラ横断ヘルパー | - |
| `core-*` (将来) | 共通型定義・共有設定 | - |

`@self/<package-name>` 名前空間で統一。

- [ ] `@self/` 名前空間 + `workspace:*` プロトコルを使用しているか
- [ ] ドメインロジックが app に埋め込まれず `packages/` に分離されているか
- [ ] dependencies は `pnpm-workspace.yaml` の `catalog:` 経由で参照しているか (個別 package で別バージョンを直書きしない)

## インフラ (`infra/`)

| stack ディレクトリ | Pulumi project name | 主リソース |
|-------------------|--------------------|----------|
| `infra/core/` | `self-management-core` | BQ dataset / SA / IAM / Grafana / Secret Manager |
| `infra/ryan-product-graph/` | (未実装) | (将来) Cloud Run / Cloud Scheduler |
| `infra/ryantsuji-dev/` | `self-management-ryantsuji-dev` | CF zone reference (今後 WorkerCustomDomain 等) |

各 stack は `Pulumi.yaml` + `Pulumi.{stack}.yaml` + `index.ts` + `package.json` + `tsconfig.json` + `README.md` を持つ。stack 名は `ryan` (1 環境のみ、個人運用)。

- [ ] secret は `pulumi config set --secret` で stack file に encrypted 保存、または `.envrc` (gitignore 済) で env var
- [ ] 手動 CLI 操作 (`gcloud` / CF dashboard / `wrangler deploy` の routes 直書き等) で drift を作っていないか (CLAUDE.md rule 5)
- [ ] 例外的に手動操作した場合、その日のうちに Pulumi state へ統合する PR を出しているか

## データ・パターン

- BQ: パラメータ化クエリ、`SELECT *` 回避、Embedding `mode: 'REPEATED'` 明示
- BQ partitioning: time-series テーブルは `_at` 列で daily partition
- 長時間処理を同期 API 内で実行しない (Cloud Run job / Pub/Sub に分離)
- 冪等性: ingest pipeline は同 source の再実行で重複ノードを作らない (`source` + `external_id` で UPSERT)

## 認証パターン

CLAUDE.md rule 6 に従う:
- ADC (user account) は使わない。`GOOGLE_APPLICATION_CREDENTIALS=$PWD/.config/gcp-sa.json` 経由の SA key で API を叩く
- `direnv` が `.envrc` で env を切替えるので、ディレクトリに入るだけで自動切替
- `gcloud` CLI は `CLOUDSDK_ACTIVE_CONFIG_NAME=ryan-personal` で個人 config に
- 例外: Pulumi 初回 setup や IAM admin 操作だけは user ADC を一時的に使う

## naming conventions

- BQ dataset: `ryan`
- Service Account: `<purpose>@ryan-self-management.iam.gserviceaccount.com`
- Pulumi project: `self-management-<stack>`、stack 名は常に `ryan`
- TypeScript file: kebab-case (`build-graph.ts`)、ただし TanStack Router の特殊 file 名 (`__root.tsx` / `$.ts` / `routeTree.gen.ts`) は規約優先
- TypeScript type / class / interface: PascalCase
- TypeScript variable / function: camelCase
- 定数: UPPER_SNAKE_CASE
- ブール値: `is` / `has` / `should` プレフィックス
- markdown file: kebab-case
- workspace package: `@self/<name>`、name は kebab-case

## review 観点

- [ ] 個人 GCP プロジェクト (`ryan-self-management`) 内のリソースのみ使っているか
- [ ] 会社 IP / 業務側の非公開情報を含めていないか
- [ ] secret が Pulumi config 暗号化 / `.envrc` / `.config/gcp-sa.json` のいずれかで管理されているか
- [ ] graph schema 変更時に migration 戦略が明記されているか
- [ ] 公開済み content のみ graph に取り込んでいるか (未公開 draft は除外)
- [ ] 新規 app / package が `apps/{category}/{name}` または `packages/{name}` のパターンに従っているか
- [ ] 新規 stack 追加時に `scripts/hooks/check-graph-tags.ts` の `STACKS` enum を先に更新しているか
