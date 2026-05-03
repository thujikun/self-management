# self-management — docs

このディレクトリは self-management リポジトリの設計・運用ドキュメント。

## 入口

| 目的 | 入口 |
|------|------|
| 長期ビジョン | [VISION.md](./VISION.md) |
| 設計方針 | [DESIGN.md](./DESIGN.md) |
| ryan-product-graph 設計 | [product-graph/README.md](./product-graph/README.md) |
| アーキテクチャ規約 | [guidelines/architecture.md](./guidelines/architecture.md) |
| MCP サーバー仕様 (将来) | [mcp/README.md](./mcp/README.md) |
| インフラ全体 | [infra/README.md](./infra/README.md) |
| 自動生成 catalog | [generated/](./generated/) |

## ドキュメント方針

- **手書き doc は概念・原則・ビジョンのみ** に絞る
- **変化しやすい情報** (アプリ一覧、テーブル一覧、stack 一覧) は generated/ で自動生成
- **個別アプリの詳細** は `apps/{name}/README.md` に置く
- **historical context は operations/log.md** に集約 (append-only)
- **意思決定の why** は `decisions/<date>-<topic>.md` で残す (将来構造化予定)

## cortex から借りているパターン

このリポジトリは cortex の以下を縮小コピーしている:

| 概念 | cortex | self-management |
|------|--------|-----------------|
| Product Graph | code + DB + docs + infra を統合 | content + decisions + topics + relationships を統合 |
| Multi-agent | ドメイン別エージェント | (将来) 投稿/engage/分析エージェント |
| Context Caching | KPI チャットの月別 TTL | (将来) ナレッジ層の TTL 戦略 |
| 「AIを信じない、仕組みで守る」 | quality gate (テスト/型/lint) | quality gate (post draft レビュー、voice 検出) |
| 共通パターン展開 | 17 MCP servers | (将来) 個人エージェント群 |
