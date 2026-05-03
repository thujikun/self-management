# アーキテクチャ・設計パターン

cortex の `docs/guidelines/architecture.md` を個人 scope に縮小したもの。

## 根本思想：Composable Architecture

cortex 同様、**「小さな機能単位を設計し、それらを組み合わせる」** Composable Architecture を採用。

- `packages/` に**再利用可能な部品**を配置 (BQ クライアント wrapper、graph schema、共通型定義)
- `apps/` の各サービスは `packages/` を組み合わせて構成
- `apps/` 同士の直接 import は禁止 — 必ず `packages/` 経由

**レビューチェック (個人運用版):**

- [ ] 新ロジックは適切な粒度の「部品」として切り出されているか (1 ファイル 1 責務)
- [ ] 既存 `packages/` を再利用しているか
- [ ] アプリ固有ロジックと共有可能ロジックが分離されているか
- [ ] apps 間の直接 import が無いか

## アプリタイプ別パターン

### graph (`apps/graph/`)

ryan-product-graph の build / migration / ingest を担当。

- `apps/graph/product/` が ryan-product-graph 本体
  - `src/schema/`: TypeScript で node/edge type と BQ table schema を定義 (SSoT)
  - `src/parsers/`: 各種 source (markdown / X API / Zenn / dev.to) からノードを抽出
  - `src/edge-detectors/`: ノード間のエッジを推定・生成
  - `src/generators/`: AI 生成 summary 等
  - `src/migrate/`: 既存 markdown → BQ 一括移行
  - `scripts/init-bq.ts`: BQ table 作成 (idempotent)
  - `scripts/build-graph.ts`: 全体ビルド orchestrator

### mcp (`apps/mcp/`、将来)

将来の MCP server を配置。`mcp-ryan-product-graph-server` が最初。Cloud Run でホスト、`infra/ryan-product-graph/` で provision。

## 共有パッケージ (`packages/`)

| 命名パターン | 役割 | 例 |
|-------------|------|----|
| `core-*` | 共通型定義・共有設定 | `core-types`, `core-config` |
| `infra-*` | インフラ横断ヘルパー | `infra-bigquery`, `infra-gcp-auth` |
| `domain-*` | ドメインロジック | `domain-graph`, `domain-x` |

`@self/<package-name>` 名前空間 (cortex の `@cortex/` に対応)。

- [ ] `@self/` 名前空間 + `workspace:*` プロトコル
- [ ] ドメインロジックは app に埋め込まず `packages/domain-*` に分離

## データ・パターン

- BQ: パラメータ化クエリ、`SELECT *` 回避
- BQ partitioning: time-series テーブルは `_at` 列で daily partition
- 長時間処理は同期 API で実行しない (将来 Cloud Run job / Cloud Functions に分離)
- 冪等性: ingest pipeline は同 source の再実行で重複ノードを作らない (`source` + `external_id` で UPSERT)

## Pulumi / インフラ

- `infra/core/`: BQ dataset、service account、IAM、Secret Manager
- `infra/ryan-product-graph/` (将来): Cloud Run for MCP server、Cloud Scheduler、Pub/Sub
- secret: `pulumi config set --secret`、stack file には encryptionsalt
- すべて個人 GCP プロジェクト `ryan-self-management` 内、location `asia-northeast1`

## naming conventions

- BQ dataset: `ryan` (cortex の `cortex` と並列)
- service account: `<purpose>@ryan-self-management.iam.gserviceaccount.com`
- Pulumi stack: 1 環境のみ (prod、個人運用)、stack 名は `ryan`
- TypeScript file: kebab-case
- TypeScript type / class: PascalCase
- TypeScript variable / function: camelCase
- markdown file: kebab-case

## review 観点

cortex のチェックリストから個人運用に関係する部分のみ:

- [ ] 個人 GCP プロジェクト内のリソースのみ
- [ ] 会社 IP / cortex 内部情報を含めていない
- [ ] secret が `.config/` か Pulumi `--secret` 経由
- [ ] graph schema 変更時に migration 戦略明記
- [ ] 公開済み content のみ graph に取り込み (未公開 draft は除外)
