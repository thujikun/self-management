# MCP サーバー (将来)

self-management で立てる予定の MCP サーバー一覧。**現時点では未実装**。

cortex の MCP サーバー (`docs/mcp/README.md` 参照) と同じ pattern で個人 scope のサーバーを順次立てる。

## 計画中

| サーバー | 役割 | 優先度 |
|----------|------|--------|
| `mcp-ryan-product-graph` | ryan-product-graph の検索・走査・ノード詳細取得 | 高 (P5) |
| `mcp-ryan-content-source` | Zenn / dev.to / X 横断検索 | 中 |
| `mcp-ryan-decisions` | 過去の判断 / 思想エントリへのアクセス | 低 |

## 設計方針 (cortex から継承)

- グラフの価値は **深い隠れた繋がりを全て辿れる** こと
- 1-2 hop は grep で十分、graph は不要
- ツール数を最小限 (5つ目安)、`trace_connections` で起点ノードから到達可能な subgraph を返す
- read-only 中心、write はエンドポイント毎に明示の OAuth が必要

## 参考

- [cortex の MCP server 構造](../../../cortex/docs/mcp/README.md) — 多くのパターンをここから借りる予定
