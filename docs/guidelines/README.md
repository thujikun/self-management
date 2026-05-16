# ガイドライン

self-management リポジトリのコードレビュー・ドキュメント作成の共通基準。

入口は [docs/review-guidelines.md](../review-guidelines.md)。本 README は分割された各ガイドラインの index。

Claude / 自動レビューエージェントは、変更ファイルの種類に応じて該当ファイルを直接参照する。

## ファイル一覧

| ファイル | 対象 | レビュー観点 |
|---------|------|-------------|
| [architecture.md](./architecture.md) | apps / packages / infra の placement、命名、Composable Architecture | スタック構造 / `@self/*` naming / pnpm catalog |
| [graph-integrity.md](./graph-integrity.md) | `@graph-*` JSDoc タグ、STACKS / DOMAINS、エッジタイプ、ドキュメント整合性 | タグ欠落 / enum 未更新 / docs 乖離 |
| [security.md](./security.md) | secret 管理、SA 最小権限、CF API token、ADC 不使用 | hardcode / 抑制コメント / hook bypass |
| [testing.md](./testing.md) | per-file 90% coverage、AAA、弱い vitest matcher 禁止、flaky 禁止 | テスト欠如 / 弱い matcher / threshold 引き下げ |
| [styling.md](./styling.md) | UI CSS / Tailwind 4 / `@self/design-tokens` 経由の semantic token 必須 | literal magic number / token 不採用 / `@theme` bypass |
| [document-writing.md](./document-writing.md) | 情報の置き場所優先順、docs ライフサイクル | 散文説明 / 重複記載 / 古い情報残置 |
| [impact-analysis.md](./impact-analysis.md) | ryan-graph での影響範囲分析、修正漏れ検出 | caller 未更新 / docs 未追従 / 類似実装未対応 |
| [severity.md](./severity.md) | Critical / Major / Minor / Nit の判定基準と降格禁止ルール | 全レビューで参照 |

## 関連

- [CLAUDE.md](../../CLAUDE.md) — リポジトリの絶対遵守ルール (8 項目)。違反は原則 **Critical**
- [review-guidelines.md](../review-guidelines.md) — レビューの入口ドキュメント
- [DESIGN.md](../DESIGN.md) — 設計方針
- [VISION.md](../VISION.md) — プロダクトビジョン
