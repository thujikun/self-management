# self-management コードレビュー観点

このドキュメントは、self-management のコードレビューで最初に読む入口。詳細な判断基準は [guidelines/](./guidelines/) 配下に分割し、Claude による自動レビューも各ファイルを直接参照する。

**個人 1 人運用 + ryan-product-graph + ryantsuji-dev (個人ブログ)** という前提の下で運用する。

## レビューの進め方

1. ryan-graph MCP (`mcp__ryan-graph__*`) で変更対象の機能・依存・影響範囲を確認する。
2. 変更ファイルの種類に応じて、下記の詳細ガイドラインを読む。
3. 指摘の重要度は [guidelines/severity.md](./guidelines/severity.md) で分類する。
4. Critical / Major / Minor は具体的な修正理由と対象行を示す。Nit は任意対応として扱う。

## 必ず見る入口

| 観点 | 詳細 | 主な対象 |
|------|------|---------|
| アーキテクチャ | [guidelines/architecture.md](./guidelines/architecture.md) | `apps/`, `packages/`, `infra/` の placement と命名 |
| Product Graph | [guidelines/graph-integrity.md](./guidelines/graph-integrity.md) | `@graph-*` タグ、STACKS/DOMAINS、ドキュメント整合性 |
| セキュリティ | [guidelines/security.md](./guidelines/security.md) | secret 管理、SA 最小権限、外部 API token |
| テスト・品質 | [guidelines/testing.md](./guidelines/testing.md) | 90% per-file coverage、AAA、弱い matcher 禁止、flaky 禁止 |
| スタイリング | [guidelines/styling.md](./guidelines/styling.md) | UI CSS / Tailwind 4 / `@self/design-tokens` semantic token 必須、magic number 禁止 |
| ドキュメント | [guidelines/document-writing.md](./guidelines/document-writing.md) | 情報の置き場所優先順、何を書く/書かない |
| 影響範囲 | [guidelines/impact-analysis.md](./guidelines/impact-analysis.md) | ryan-graph traverse + semantic で修正漏れ検出 |
| 重要度分類 | [guidelines/severity.md](./guidelines/severity.md) | Critical / Major / Minor / Nit の判定 |

## 根本対応の原則

レビュー指摘は **該当 PR 内で根本原因に対処する**。症状緩和パッチ・回避策・別 PR への切り出しは原則として認めない。

- **根本対応必須**: アーキテクチャ違反 / 設計欠陥 / 仕様逸脱 / 安全性の欠陥は、その PR 内で原因そのものを直す。表層的な if 分岐の追加やエラー隠蔽だけで閉じない。
- **後回しの禁止**: 「別 PR で対応」「次のセッションで対応」「スコープ外」「段階的に」を理由とした未対応・部分対応を禁止。
- **TODO / FIXME による先送り禁止**: レビュー指摘の残課題を `TODO` / `FIXME` コメントとしてコードに残してマージしない。
- **降格禁止**: 後回し・段階的実装を理由として重要度を Nit に降格しない。詳細は [guidelines/severity.md](./guidelines/severity.md) の「降格禁止ルール」を参照。

例外条件はこのドキュメントに型としては列挙しない。例外が必要な状況は都度判断し、合意内容を PR 上で明示する。

## 最重要ゲート (CLAUDE.md 由来、絶対遵守)

[CLAUDE.md](../CLAUDE.md) で定義された 8 ルールはこのリポジトリの **絶対遵守事項**。違反は原則 **Critical** で `REQUEST_CHANGES`。

| # | ルール | 機械強制 |
|---|--------|---------|
| 1 | `--no-verify` / `-n` / `--no-gpg-sign` 等の hook bypass 禁止 | 運用 (履歴で検出可) |
| 2 | `eslint-disable` / `@ts-ignore` / `@ts-nocheck` / `@ts-expect-error` / `prettier-ignore` / `biome-ignore` 禁止 | `scripts/hooks/check-no-ignore.sh` |
| 3 | `apps/` / `packages/` / `infra/` 配下の `.ts` / `.tsx` に `@graph-stack` / `@graph-domain` / `@graph-business` / `@graph-connects` タグ必須 | `scripts/hooks/check-graph-tags.ts` |
| 4 | コード行 (コメント・空行除く) 500 行上限 | `scripts/hooks/check-line-count.ts` |
| 5 | GCP / CF リソースは Pulumi 経由でのみ管理 (drift 厳禁) | レビュー (例外時は同 PR で Pulumi state へ統合) |
| 6 | ADC (user account) 不使用、SA key + direnv で `GOOGLE_APPLICATION_CREDENTIALS` 切替 | 運用 |
| 7 | Conventional Commits 形式 (type 小文字、subject 末尾ピリオドなし、ヘッダー 100 字以内) | `commitlint` (commit-msg hook) |
| 8 | X 過去 post / 関係性検索は `mcp__ryan-graph__*` 経由 (xmcp は投稿時のみ) | 運用 (コスト直結) |

詳細は [CLAUDE.md](../CLAUDE.md) を SSoT として参照する。本ドキュメントは判定基準のみ持ち、ルール本体は重複させない。

## 二次ゲート

### Composable Architecture

構造レベル + 関数 / フックレベルの両方で composability を要求する。

**構造レベル:**

- `packages/` は再利用可能な部品、`apps/` はそれを組み合わせるサービス、`infra/` は Pulumi スタック。
- `apps/` 同士の直接 import が無く、共有可能ロジックは `packages/` に置かれているか。
- 新規 app / package は既存カテゴリのパターンと命名 (`@self/<name>`、kebab-case ファイル) に従っているか。

**関数 / フックレベル (state → 副作用):**

- state を更新する副作用 (cookie write / URL 書換 / loader 再評価 / store invalidate 等) が **1 つの primitive** に閉じているか。caller (button onClick / event handler) が複数の副作用を順次直叩きしていないか。
- URL は state から派生する従属物として扱われ、`router.navigate` 等の宣言的 API 経由で更新されているか (`history.replaceState` を裸で叩いていないか)。
- 副作用が引数注入できる shape で、純粋 logic を test で spy できる構造か。

### コードコメント

- コメントが**現状の意図**だけを書いているか。bug-cause / 変更経緯 / 過去実装との対比が紛れていないか (これらは PR description / commit body 側に残す)。
- 「旧実装で…の問題が解消する」「以前は…していたが」系の歴史を書いたコメントは指摘対象。

詳細は [guidelines/architecture.md](./guidelines/architecture.md) (Composable + コメント方針)。

### Product Graph 整合性

- 新規・変更された宣言に必要な `@graph-*` タグがあるか。
- `@graph-stack` / `@graph-domain` の値が `scripts/hooks/check-graph-tags.ts` の `STACKS` / `DOMAINS` enum に登録済か (新規追加時は enum を先に更新)。
- ryan-graph (BQ) と Pulumi スタックと docs の接続が `@graph-connects` で追えるか。

詳細は [guidelines/graph-integrity.md](./guidelines/graph-integrity.md)。

### セキュリティと境界

- secret は Pulumi config (encrypted)、Secret Manager、または `.envrc` (gitignore) のいずれかで管理されているか。
- ハードコードされた token / API key / password が無いか。
- SA / IAM が最小権限になっているか (Pulumi 上で role 過剰付与されていないか)。
- ユーザー入力 / 外部 API レスポンスが境界で Zod で検証されているか。

詳細は [guidelines/security.md](./guidelines/security.md)。

### テストと検証

- 変更された振る舞いに対するテストが先に追加されているか (TDD でなくても、PR 内で同居させる)。
- per-file 90% coverage threshold (statements / branches / functions / lines 全部) を下げていないか。
- 弱い matcher (`toBeDefined`, `toContain`, `expect.objectContaining` 等) で済ませていないか。
- flaky を retry / quarantine で隠していないか (root cause を直す)。

詳細は [guidelines/testing.md](./guidelines/testing.md)。

### スタイリング (design-tokens 必須)

- UI CSS / Tailwind utility / inline style に literal magic number (`16px`, `#0abab5`, `44rem` 等) が直書きされていないか。
- color / spacing / radius / blur / font / motion / layout container / breakpoint / overlay の 9 カテゴリで `@self/design-tokens` semantic var (または `@theme` で bridge した Tailwind utility) を経由しているか。
- 既存 token に該当値が無い時は、`@theme` block か `packages/design-tokens/src/{primitive,semantic}.ts` に **先に追加** してから採用しているか。
- 例外 (viewport units / 装飾固有の構造 literal) は **コメントで理由明示** されているか。

詳細は [guidelines/styling.md](./guidelines/styling.md)。

### ドキュメント整合性

- 機能変更に対応する docs (`docs/{category}/...md` または `apps/{name}/README.md`) が同 PR で更新されているか。
- 「現在の実装を散文で説明」する加筆になっていないか (それはコードと型に書く)。
- 完了した計画書は `docs/plans/archived/` (将来) に移動しているか。

詳細は [guidelines/document-writing.md](./guidelines/document-writing.md)。

## 判定フロー

| 判定 | 条件 | 対応 |
|------|------|------|
| Critical | CLAUDE.md 違反、セキュリティ、データ破壊、テスト coverage threshold 引き下げ、`@graph-*` タグ欠落、ドキュメント不整合 | 必ず修正要求 |
| Major | Composable 違反、テスト不足 (新規コードに test 無し)、Pulumi drift、commitlint 違反 | 原則修正要求 |
| Minor | 命名改善、軽微なリファクタリング提案、`packages/` 切り出し提案 | 修正を推奨 |
| Nit | 表記ゆれ、コメント微修正、任意の整理 | ブロックしない |

重要度の詳細と例外条件は [guidelines/severity.md](./guidelines/severity.md) を優先する。

## 自動レビュー運用 (Claude / 自動エージェント向け)

- 良い点だけのコメントは出さない。修正が必要な箇所に絞る。
- 指摘には対象ファイル、行番号、問題、修正理由、確認方法を含める。
- `APPROVE` する場合でも、残るリスクや未実行の検証があれば明記する。
- 同種の指摘 (同一 family) は重複させない。1 件にまとめる。

## 関連ドキュメント

- [CLAUDE.md](../CLAUDE.md) — リポジトリの絶対遵守ルール (8 項目)
- [DESIGN.md](./DESIGN.md) — 設計方針
- [VISION.md](./VISION.md) — プロダクトビジョン
- [guidelines/README.md](./guidelines/README.md) — 分割された詳細ガイドライン
- [infra/README.md](./infra/README.md) — インフラ構成と運用
- [product-graph/README.md](./product-graph/README.md) — Product Graph 設計
