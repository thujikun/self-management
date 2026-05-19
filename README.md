# self-management

Ryan の個人ナレッジ・運用基盤。個人の content・思想・engagement・関係性を Product Graph として統合するモノレポ。

## このリポジトリの目的

- **個人の content・思想・engagement を1つのグラフに統合する** (X、Zenn、dev.to、インタビュー、登壇、Slack、メモ等)
- **AI agent (Claude Code) が autonomously 個人運用できる基盤** を作る
- **個人 GCP プロジェクト** (`ryan-self-management`) で運用

## scope の階層

```
self-management        ← Ryan というシステム全体
  ├── X 運用           ← apps/x/, threads/, operations/
  ├── content 配信     ← Zenn, dev.to, 登壇等
  ├── 思想ナレッジ     ← decisions, topics, references
  └── ryan-product-graph  ← 全ノード+エッジを統合する graph layer
```

X はその一部でしかない。

## 読み始める入口

| 目的 | 入口 |
|------|------|
| 全体ビジョン | [docs/VISION.md](./docs/VISION.md) |
| 設計方針 | [docs/DESIGN.md](./docs/DESIGN.md) |
| Product Graph (ryan-product-graph) | [docs/product-graph/README.md](./docs/product-graph/README.md) |
| アーキテクチャ規約 | [docs/guidelines/architecture.md](./docs/guidelines/architecture.md) |
| X 運用戦略 | `x-account-strategy.md` (local-only、`.gitignored`) |
| X 運用ログ | `operations/log.md` (local-only、`.gitignored`) |

## ディレクトリ構成

```
~/Workspace/self-management/
├── docs/                    # documentation (人間用)
│   ├── README.md           # docs index
│   ├── VISION.md           # 長期ビジョン
│   ├── DESIGN.md           # 設計方針
│   ├── guidelines/         # 開発・運用規約
│   ├── product-graph/      # ryan-product-graph 設計
│   ├── mcp/                # MCP サーバー仕様 (将来)
│   └── generated/          # 自動生成 catalog
├── apps/                    # 実行単位
│   ├── graph/product/      # ryan-product-graph build pipeline
│   └── mcp/                # MCP サーバー (将来)
├── packages/                # 共有 TS package
├── infra/                   # Pulumi stacks
│   ├── core/               # 共通 infra (BQ dataset, IAM)
│   └── ryan-product-graph/ # graph 専用 infra (Cloud Run 等)
├── threads/                 # X thread drafts + posted archive
├── operations/log.md        # 運用ログ (人間 narrative、local-only / .gitignored)
├── playbooks/               # 自動化手順書
├── analytics/               # daily metrics
├── scripts/                 # 雑多な shell scripts
├── config/                  # ローカル env (.gitignored)
└── x-account-strategy.md    # X 運用戦略 (憲章、local-only / .gitignored)
```

> `operations/log.md` と `x-account-strategy.md` は **`.gitignored` で local-only**。named individuals への label / voice rules / 戦略詳細を public repo に蓄積しないため。clone 時は不在で、graph migrate / compact-log script は file 存在時のみ動作する。

## quick start (新規環境セットアップ)

前提: Node.js >=24、`pnpm@10.33.2` (`packageManager` field 経由で corepack が自動有効化)。

```bash
# 1. direnv 有効化
direnv allow

# 2. 個人 gcloud config に切替されることを確認
gcloud config configurations list  # ryan-personal が ACTIVE

# 3. 依存インストール (Node 24+ 必須、package.json engines で強制)
pnpm install

# 4. Pulumi で BQ provision (初回のみ)
cd infra/core && pulumi up

# 5. graph スキーマで BQ tables 作成
pnpm graph:init

# 6. 既存 markdown を BQ に移行
pnpm graph:build  # (将来 implementation)
```
