# 重要度分類・判定基準

CLAUDE.md 違反は全て **Critical** に固定する。

## 重要度

| 重要度 | 基準 | アクション |
|--------|------|-----------|
| **Critical** | CLAUDE.md 違反 (`--no-verify` / 抑制コメント / `@graph-*` 欠落 / 500 行超え / Pulumi 外手動操作 drift / ADC 使用 / commitlint 違反 / xmcp 経由の過去 post 取得)、セキュリティ脆弱性 (secret hardcode / SA 権限過剰 / 認証回避)、データ破壊リスク、本番障害の可能性、**ドキュメント不整合** (対応 doc の欠如・未更新)、**テスト coverage threshold の引き下げ** (`vitest.config.ts` の 90% を下げる変更は禁止) | `REQUEST_CHANGES` |
| **Major** | Composable Architecture 違反 (`apps/` 間の直接 import、`packages/` 切り出し漏れ)、テスト欠如 (新規コードに `*.test.ts` が無い)、弱い vitest matcher (`toBeDefined` / `toContain` / `expect.objectContaining` 等) で重要 assertion を済ませている、flaky を retry / `skip` で隠している、Pulumi 外で手動操作した drift を放置している、deploy pipeline の整合性を壊している | `REQUEST_CHANGES` |
| **Minor** | 命名改善、軽微なリファクタリング提案、コメント追加、`packages/` への切り出し提案、関数引数 3 個超え (オブジェクト引数化)、早期リターン化、コメント言語の不揃い (日本語に統一) | `REQUEST_CHANGES` |
| **Nit** | スタイル好み、表記ゆれ、微細な改善、import 順序 | `APPROVE`(コメントで指摘) |

## CLAUDE.md ルール別の重要度

| CLAUDE.md ルール | 違反パターン | 重要度 |
|-----------------|-------------|--------|
| 1. `--no-verify` 禁止 | bypass flag を使った commit / push | **Critical** (commit history で即発見、即 revert) |
| 2. 抑制コメント禁止 | `eslint-disable` / `@ts-ignore` 等の追加 | **Critical** (`scripts/hooks/check-no-ignore.sh` で機械検出) |
| 3. `@graph-*` タグ必須 | ファイル先頭または top-level decl にタグ無し | **Critical** (`scripts/hooks/check-graph-tags.ts` で機械検出) |
| 3. `@graph-stack` / `@graph-domain` の値 | enum に未登録の値を使用 | **Critical** (enum 先更新せずに違反) |
| 4. 500 行上限 | コード行 (コメント・空行除く) 500 超え | **Critical** (`scripts/hooks/check-line-count.ts` で機械検出) |
| 5. Pulumi 集約 | `gcloud` / CF dashboard / `wrangler` で resource 直作成して放置 | **Critical** (drift 検出時即座に Pulumi state へ統合) |
| 6. ADC 不使用 | `gcloud auth application-default login` を業務処理で使用 | **Critical** (実装側で ADC を呼ぶ箇所を SA 経由に直す) |
| 7. Conventional Commits | type 大文字 / subject 末尾ピリオド / 100 字超え / `[skip ci]` 系 skip-ci magic 5 種 literal 混入 | **Major** (commitlint で機械検出。`no-skip-ci-magic` rule、説明用に綴る時は NBSP `[skip ci]` か split `"[skip" + " ci]"` で escape) |
| 8. ryan-graph 経由優先 | xmcp で過去 post / engagement を取得 | **Major** (コスト直結、ryan-graph search に置換) |

## 降格禁止ルール

以下のいずれの理由でも重要度を Nit に降格してはならない。該当 PR 内での根本対応を求める。

- **「既存パターンに従った追加」を理由にした降格禁止**: 既存コードがガイドラインに違反している場合、それに従った新規コードも同じ重要度で指摘する。「次回リファクタリング時に検討」のような先送りコメントは認めない。
- **「別 PR で対応」「次のセッションで対応」「スコープ外」「段階的に」を理由にした降格禁止**: 後回し・部分対応を前提に Critical / Major / Minor を Nit へ落とすことは禁止。
- **TODO / FIXME 残置を理由にした降格禁止**: コード内の TODO / FIXME に残課題を書き残しても、それで重要度が下がることはない。レビュー指摘は該当 PR 内で根本原因まで直す。
- **「個人 repo だから」を理由にした降格禁止**: self-management が個人 repo であることは、品質基準を下げる理由にならない。むしろ「最初から整えないと運用できない」前提で 90% per-file coverage や `--no-verify` 全面禁止を採用している ([CLAUDE.md](../../CLAUDE.md))。

例: 関数の引数が 3 つを超えている (オブジェクト引数にすべき) 場合、既存関数が同じ違反をしていても **Minor** (`REQUEST_CHANGES`) として指摘する。Nit にしない。

降格判断における例外条件はこのドキュメントには列挙しない。例外が必要な状況は都度判断し、合意内容を PR 上で明示する。

## マージ条件

- 全レビューコメントが resolved された場合のみマージ可能。
- `APPROVE` かつ未解決コメントがある場合はマージ保留。
- pre-commit hook (`scripts/hooks/*` と vitest coverage) を bypass せずに pass している。
- `pnpm test` / `pnpm typecheck` / `pnpm lint` が全 green。

## レビューコメントの方針

- 問題点・改善点のみを報告する。良い点の報告 (「LGTM」「良い設計です」等のポジティブコメント) は不要。
- 指摘には **対象ファイル + 行番号 + 問題 + 修正理由 + 確認方法** を含める。
- 同じ意図の指摘 (同一 family) は 1 件にまとめる。複数箇所に出ている場合は代表 1 箇所 + 「他に N 箇所」と書く。
- `APPROVE` する場合でも、残るリスクや未実行の検証があれば明記する (例: 「`pnpm dev` での実機確認は未実行、Ryan 側で確認推奨」)。
