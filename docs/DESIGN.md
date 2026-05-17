# self-management 設計方針

個人 scope の知識基盤としての設計方針。

## 設計方針

### 1. TypeScript を共通言語にする

apps、packages、infra (Pulumi) を TypeScript で統一。仕様理解・型安全・変更追跡の入口を揃える。

### 2. BigQuery + GCS をデータ基盤の中心に置く

- BigQuery: 構造化された ryan-product-graph (nodes / edges) と analytics
- GCS: 中間置き場 (将来 Meet 録画 / 登壇スライド等を保管する場合)

dataset: `ryan` (個人スコープを示す命名)

### 3. 公開と非公開を分離する

- **公開 content** (X / Zenn / dev.to / 登壇): 既に external 公開済、graph に取り込む
- **非公開 content** (judging notes / draft / DM 履歴 / decisions): graph に取り込むが BQ は private project (`ryan-self-management`)
- **会社 IP** は graph に入れない。業務知識は業務側システムで管理する

### 4. 非同期処理を前提に境界を明確にする

- X API → BQ ingest pipeline (Cloud Functions / Cloud Run jobs)
- post 実行 → BQ 反映 (post script の post-effect として書き込み)
- daily analytics rollup (Cloud Scheduler)

### 5. ryan-product-graph を変更調査の正本にする

- 「過去にこの topic を何度発信した?」 → graph query
- 「この decision はどの content / event から来てる?」 → graph query
- 「最近 engage してくれてる人は?」 → graph query

ad-hoc な markdown grep ではなく、graph の自然言語 query (将来 MCP server 経由で claude -p から呼ぶ) を正本にする。

### 6. 詳細仕様は実装と生成物を正とする

- アプリ一覧、stack 一覧、テーブル一覧 → `docs/generated/` に自動生成
- 手書き doc は方針・概念・ビジョン only

## 情報の正規の置き場所

| 知りたいこと | 正規の置き場所 |
|--------------|----------------|
| アプリ一覧 | `docs/generated/app-catalog.md` (将来自動生成) |
| Pulumi スタック一覧 | `docs/generated/infra-stacks.md` (将来自動生成) |
| BQ table schema | `apps/graph/product/src/schema/` (TS 型定義 = SSoT) |
| X 投稿の history | `ryan.product_graph_nodes` (BQ) + `threads/posted/` (markdown archive) |
| 思想 / decision | `decisions/<date>-<topic>.md` + `ryan.product_graph_nodes` (decision type) |
| X 運用戦略 | `x-account-strategy.md` (root) |
| 過去ブログ記事 | `ryan.product_graph_nodes` (content type, source: zenn/devto) |

## tooling

| カテゴリ | 採用 |
|----------|------|
| 言語 | TypeScript |
| package manager | pnpm (workspace) |
| infra as code | Pulumi |
| CI/CD | (未定、当面なし) |
| BQ クライアント | `@google-cloud/bigquery` |
| direnv | gcloud config / 個人 secret 切替 |
| MCP server | (将来) FastMCP-style or hono based |

## レビュー時の最小チェック

- [ ] 個人 GCP プロジェクト (`ryan-self-management`) 内のリソースのみ触っている
- [ ] 会社 IP / 業務側の非公開情報を含めていない
- [ ] 公開済み content (Zenn / dev.to / 公開 X 投稿) は引用 OK、未公開のものは含めない
- [ ] secret は `.config/` (gitignored) または Pulumi config の `--secret` 経由
- [ ] 変更が graph schema に及ぶ場合、migration 戦略を明記
