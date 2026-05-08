# ドキュメントガイドライン

cortex の `docs/guidelines/document-writing.md` を self-management の docs 構造 (`docs/README.md` / `docs/DESIGN.md` / `docs/VISION.md` / `docs/guidelines/` / `docs/{category}/README.md` / `apps/{name}/README.md`) に合わせて適用する。

## 原則

### コードが唯一の真実である

ドキュメントはコードの二次情報に過ぎない。コードと矛盾するドキュメントは害になる。ドキュメントを書く前に、その情報をコード・型・テスト・lint ルールで表現できないか検討する。

### ドキュメントの価値は鮮度に依存する

書いた瞬間が価値のピークであり、時間と共に劣化する。維持コストを払えないドキュメントは書かない。書くなら維持する仕組みも一緒に作る。

### 読者はコードを読める

self-management の docs/ の主な読者は **Ryan 本人 + 将来の Claude エージェント**。「どう動くか」をコードより分かりやすく説明し直す必要はない。読者が本当に必要としているのは「なぜそうなっているか」と「どこから読み始めればよいか」の 2 つ。

### 判断の優先順位

情報を残したいとき、上から順に検討する。上で表現できるものを下で書いてはいけない。

| 優先度 | 手段 | 理由 |
|--------|------|------|
| 1 | **型定義** | コンパイラが検証。実行時コストゼロ |
| 2 | **lint ルール** (`eslint.config.js` + `scripts/hooks/*`) | 毎回実行。file:line で報告。違反 = pre-commit fail |
| 3 | **テスト** (vitest 90% per-file) | CI で実行。振る舞いをアサーションで記述 |
| 4 | **スキーマバリデーション** (Zod) | 境界で実行時に検証 |
| 5 | **`@graph-*` JSDoc アノテーション** | コードに付与するだけで Product Graph ノードを自動生成。Why・接続先・ドメインを構造化して記録 |
| 6 | **自動生成ドキュメント** (`docs/generated/`) | コードから派生。再生成で drift を防止 |
| 7 | **手書きドキュメント** (`docs/{category}/...md`、`apps/{name}/README.md`) | 最後の手段。上のどれでも表現できない場合のみ |

> 順序は「どの手段で表現するかを選ぶ」際の検討順であり、各手段の重要度を示すものではない。たとえば `@graph-*` アノテーションの欠如は [graph-integrity.md](./graph-integrity.md) で **Critical** と定義されている。

## 何を書くか

### Why ドキュメント

「なぜそうなっているか」を記録するもの。コードからは読み取れない意思決定の背景。

例:
- `docs/DESIGN.md`: ryan-product-graph を BQ ベースで作る理由、cortex から借りているパターン
- `docs/VISION.md`: self-management 全体のビジョン
- `docs/guidelines/architecture.md`: Composable Architecture を採用する理由

### How to get started ドキュメント

セットアップ手順 — スクリプトで自動化できる部分はスクリプトにして、ドキュメントはスクリプトの実行方法だけ書く。

例:
- `infra/{stack}/README.md`: `pulumi stack init ryan` / `pulumi config set --secret ...` / `pulumi up` の手順 + 必要 token / scope
- `apps/{name}/README.md`: `pnpm install` / `pnpm dev` / `pnpm deploy` の流れ

### アプリケーションドキュメント

各 app の目的・アーキテクチャ・エンドポイント・設定・デプロイ情報を `apps/{name}/README.md` に記述する。

書くべき内容:
- 目的 (1-2 文で何をする app か)
- アーキテクチャ図 (mermaid。データフローの全体像、Pulumi スタックとの関係)
- このアーキテクチャを採用した理由 (なぜこの構成か、他の選択肢を捨てた根拠)
- 仕組みのポイント (コードを読むだけでは分からない設計上の要点。例: Hono RPC で `/api/*` catch-all、TanStack Start v1.167+ の `getRouter` virtual module convention)
- インフラ経由の依存先 (CF zone / Cloud Scheduler / Pub/Sub 等を介した暗黙的依存)
- エンドポイント一覧 (テーブル形式)
- 設定 (環境変数、`wrangler.jsonc` の bindings、Pulumi config)
- デプロイ情報 (スタック名、Pulumi パス、`pnpm run deploy` の流れ)

### 運用ドキュメント

- **`docs/review-guidelines.md`**: コードレビューの判断基準。Claude による自動レビューのプロンプトとしても使われるため、曖昧な表現を避け、判定可能な基準で書く。
- **`docs/observability.md`** (将来): 可観測性基盤の構成、アラート・ダッシュボード設計

### ガイドライン

- `docs/guidelines/{topic}.md`: 横断的な判断基準。本 README のような index ファイルは `docs/guidelines/README.md` に置く。

## 何を書かないか

### 現在の実装を散文で説明するもの

「このシステムは現在こう動いている」という説明文。コードが変わった瞬間に嘘になる。

代わりに、コードのエントリポイントを示す (「`apps/ryantsuji-dev/web/src/router.tsx` の `getRouter` から読み始める」)。

### 手書きの API リファレンス

エンドポイントのリクエスト / レスポンス仕様を手書きで維持するもの。OpenAPI スキーマからの自動生成、または型定義 (Hono RPC `ApiType`) からの導出を使う。手書きが必要な場合はエンドポイント一覧 (名前・メソッド・役割の 3 列テーブル) に留める。

### 完了した計画をそのまま残すもの

実装が終わった計画書を「実装済み」マーク付きで残し続けるパターン。AI エージェントは区別なく文脈として読み込む。完了した計画は `docs/plans/archived/` (将来) に移動する。

### コードのコメントで十分な情報

関数の引数の意味、処理の手順、条件分岐のロジック。これらはコードのインラインコメントや JSDoc (`@graph-business`) で書く。docs/ に分離すると、コード変更時に同期されない。

### 同じ情報の複数箇所への記載

情報の正規の置き場所は 1 箇所。他の場所からはリンクで参照する。

例:
- CLAUDE.md ルール 8 個は CLAUDE.md が SSoT。`docs/review-guidelines.md` はリンクのみ持つ。
- `STACKS` / `DOMAINS` enum は `scripts/hooks/check-graph-tags.ts` が SSoT。docs はリンクのみ。

### 感覚的・主観的な品質基準

「きれいなコードを書く」「適切に設計する」のような基準。具体的で判定可能な基準として書く。lint ルール / hook / テストで機械的に検証できるならそちらを優先する。

### 内部実装の詳細を含む MCP ドキュメント

MCP サーバーのドキュメント (将来 `apps/mcp/{name}/README.md`) は利用者向け。利用者が知る必要のない実装詳細は書かない。書くべきは tool 一覧、ユースケース、セットアップ手順。

### 陳腐化した技術スタック一覧

バージョン番号付きで列挙するパターン。`pnpm-workspace.yaml` (catalog) / `package.json` / `Pulumi.yaml` / `wrangler.jsonc` がバージョン情報の正規の置き場所。docs/ には技術選定の理由 (Why) だけを ADR で記録する。

## ライフサイクル

### 更新

ドキュメントの更新は、対応するコードの変更と同じ PR で行う。「後で更新する」は実質「更新しない」と同義。

CLAUDE.md / `docs/review-guidelines.md` の **ドキュメント不整合 = Critical** ルールがこれを機械強制する。

### 廃止

- 完了した計画書は `docs/plans/archived/` に移動する (将来パスを切る)
- 削除した app / package の対応ドキュメントも削除する
- 内容が現状と乖離し更新コストが見合わないドキュメントは削除する。git 履歴に残るので復元は可能

### 書くべきか迷ったら

| 質問 | Yes なら |
|------|---------|
| コードや型で表現できるか? | 書かない。コードに書く |
| lint ルール / hook / テストで検証できるか? | 書かない。ルールを作る |
| 自動生成できるか? | 手書きしない。スクリプトを作る (`docs/generated/`) |
| 1 箇所だけ更新すれば済むか? | 正規の場所に 1 回だけ書く |
| 半年後も正確である自信があるか? | No なら書かない |
| 読者 (Ryan / Claude) はこの情報なしで困るか? | No なら書かない |

## レビュー時のチェック観点

- [ ] 機能変更に対応する docs (`docs/{category}/*.md` または `apps/{name}/README.md`) が同 PR で更新されているか
- [ ] 「現在の実装を散文で説明」する加筆になっていないか (それは型 / lint / test に書く)
- [ ] 同じ情報を複数箇所に書いていないか (SSoT を 1 箇所に固定して他はリンク)
- [ ] 完了した計画書が `docs/plans/archived/` (将来) に移動されているか
- [ ] バージョン番号や stack 一覧をハードコードしていないか (`docs/generated/` で自動生成 or 該当 `package.json` / `Pulumi.yaml` を SSoT 化)
