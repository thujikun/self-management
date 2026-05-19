# self-management — docs

このディレクトリは self-management リポジトリの設計・運用ドキュメント。

## 入口

| 目的 | 入口 |
|------|------|
| 長期ビジョン | [VISION.md](./VISION.md) |
| 設計方針 | [DESIGN.md](./DESIGN.md) |
| ryan-product-graph 設計 | [product-graph/README.md](./product-graph/README.md) |
| **コードレビュー観点** | **[review-guidelines.md](./review-guidelines.md)** |
| **ガイドライン (詳細)** | **[guidelines/README.md](./guidelines/README.md)** |
| **build pipeline (turbo)** | **[build-pipeline.md](./build-pipeline.md)** |
| spike 記録 | [spike/](./spike/) |
| MCP サーバー仕様 (将来) | [mcp/README.md](./mcp/README.md) |
| インフラ全体 | [infra/README.md](./infra/README.md) |
| 自動生成 catalog | [generated/](./generated/) |

## ドキュメント方針

- **手書き doc は概念・原則・ビジョンのみ** に絞る
- **変化しやすい情報** (アプリ一覧、テーブル一覧、stack 一覧) は generated/ で自動生成
- **個別アプリの詳細** は `apps/{name}/README.md` に置く
- **historical context は operations/log.md** に集約 (append-only、`.gitignored` で local-only)
- **意思決定の why** は `decisions/<date>-<topic>.md` で残す (将来構造化予定)

## 基盤パターン

このリポジトリで採用している主な構造:

| 概念 | self-management での適用 |
|------|--------------------------|
| Product Graph | content + decisions + topics + relationships を統合 |
| Multi-agent | (将来) 投稿/engage/分析エージェント |
| Context Caching | (将来) ナレッジ層の TTL 戦略 |
| 「AIを信じない、仕組みで守る」 | quality gate (post draft レビュー、voice 検出) |
| 共通パターン展開 | (将来) 個人エージェント群 |
