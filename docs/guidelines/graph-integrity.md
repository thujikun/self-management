# Product Graph 整合性

ryan-product-graph は self-management のコア。コードの What だけでなく Why を構造化し、ryan-graph (BQ + embedding) による semantic search、影響範囲分析、横断的な活動 traverse を支える。**Product Graph の品質 = self-management の知識基盤の品質**。

cortex の `docs/guidelines/graph-integrity.md` を、ESLint plugin ではなく `scripts/hooks/check-graph-tags.ts` ベースに置き換えて運用する。

## `@graph-*` JSDoc タグ (必須)

`@graph-*` タグは Product Graph の Single Source of Truth。`apps/`, `packages/`, `infra/` 配下の `.ts` / `.tsx` ファイルでは、機械的に検証される (`scripts/hooks/check-graph-tags.ts` で pre-commit + CI 強制)。

### ファイル先頭 JSDoc (必須 4 タグ)

```ts
/**
 * <ファイルの 1-2 文要約>
 *
 * <設計上のポイントや制約があればここに>
 *
 * @graph-stack <STACKS の値>
 * @graph-domain <DOMAINS の値>
 * @graph-business <ビジネスコンテキストを 1 文。embedding 品質を決める>
 * @graph-connects <target> [<edgeType>] <description>
 */
```

- [ ] ファイル先頭 JSDoc に 4 タグ全てあるか
- [ ] `@graph-stack` の値が `scripts/hooks/check-graph-tags.ts` の `STACKS` set に登録済みか
- [ ] `@graph-domain` の値が `DOMAINS` set に登録済みか
- [ ] `@graph-business` がビジネスコンテキスト (日本語) を含んでいるか — これが Embedding の品質を決定する
- [ ] `@graph-connects` のフォーマット `<target> [<edgeType>] <description>` を守っているか

### トップレベル宣言 (必須 1 タグ)

`export const` / `export function` / `export class` / 非 export の `const` / `function` / `class` 全てに `@graph-connects` が必要。接続が無ければ明示的に `none` を書く。

```ts
/** @graph-connects bigquery [writes_to] node 行を upsert */
export async function upsertNode(node: Node) { ... }

/** @graph-connects none */
const cache = new Map();
```

- [ ] 全てのトップレベル宣言に `@graph-connects` があるか (関数 / class / トップレベル変数 / let / var を含む)
- [ ] 外部接続が `<target> [<edgeType>] <description>` で明記されているか
- [ ] 接続なしのものに `@graph-connects none` が明示されているか
- [ ] `@graph-connects none` を付けた宣言の中で外部呼び出し (BQ / GCP / fetch / DB) が起きていないか (起きていれば嘘なので Critical)

### 例外: type / interface / enum

`type` / `interface` / `enum` 宣言は `@graph-connects` 不要 (cortex の `requireForTypes: false` と同じデフォルト)。実行時ロジックを持たないため。

### 例外: `bin/` / `*.cli.ts` / `*.test.ts`

CLI entry point (`scripts/hooks/*.cli.ts` や `apps/*/scripts/*.ts` の bin wrapper) は `process.argv` / staged file 取得 / `process.exit` の薄ラッパーで、純粋ロジックは sibling lib に分離する設計。テスト対象外であり `@graph-*` も不要。

`scripts/hooks/check-graph-tags.ts` の `EXCLUDE_RE` がこの例外を機械的に処理する。

### 例外: `routeTree.gen.ts`

TanStack Router 自動生成ファイル。git ignore 済、自動付与の lint/type 抑制ヘッダー付き、`vitest.config.ts` の coverage exclude と pre-commit hook の対象外。

## STACKS / DOMAINS の管理

`scripts/hooks/check-graph-tags.ts` の以下が SSoT:

```ts
export const STACKS = new Set(["core", "ryan-product-graph", "ryantsuji-dev"]);
export const DOMAINS = new Set(["infra", "graph", "x-runtime", "content-pipeline", "release-management", "publishing"]);
```

- [ ] 新規 stack を追加する PR は **enum 更新を最初に行っている** か (enum 未更新で後段ファイルに新値を書くと hook で fail)
- [ ] 新規 domain を追加する PR は同上
- [ ] enum から **値を削除する場合**、その値を使っているファイルが PR 内で全て移行されているか

## エッジタイプ

`@graph-connects` の `[edgeType]` には次のいずれかを使う (cortex と同じセット):

| エッジタイプ | 意味 |
|-------------|------|
| `calls` | 関数 / メソッド呼び出し |
| `queries` | DB / BQ への SELECT |
| `writes_to` | DB / BQ / GCS / R2 / KV への書き込み |
| `reads_from` | DB / BQ / 外部 API からの読み出し |
| `triggers` | Pub/Sub publish、Cloud Scheduler 起動、webhook |
| `publishes` | message 配信 / RSS feed 等 |
| `references` | 型・定数・スキーマ参照 |
| `delegates_to` | 中継 (catch-all → Hono など) |
| `embeds` | フレームワークプラグインを pipeline に組み込む |
| `provides` | 型 / instance / 関数を export してダウンストリームに提供 |
| `returns` | function の return value |

- [ ] エッジタイプが実際の接続を正しく表現しているか (例: BQ `INSERT` を `reads_from` と書いていないか)
- [ ] 境界ノード (リポジトリをまたぐ接続点 — CF / Neon / Upstash / X API / Zenn / dev.to) が適切に宣言されているか

## ドキュメント整合性 (`docs/`)

`docs/` 配下の `.md` ファイルは将来 Document ノードとして ryan-graph に取り込む予定 (現状は graph 化されていないが、本ドキュメントで方針を固定する)。

> **必須**: 処理の追加・修正を含む全ての PR で、対応するドキュメント (`docs/{category}/{name}.md` または `apps/{name}/README.md`) の存在と更新状況を必ずチェックすること。ドキュメントが存在しない、または変更内容が反映されていない場合は **Critical** (`REQUEST_CHANGES`)。ドキュメント更新のみの PR (コード変更なし) は本チェックの対象外。

**全コード変更共通 (必須):**

- [ ] 変更対象のスタック / アプリに対応するドキュメントが `docs/{category}/{name}.md` または `apps/{name}/README.md` に存在するか (存在しなければ **Critical**: 作成必須)
- [ ] 変更内容 (機能追加・修正・API 変更・アーキテクチャ変更等) がドキュメントに反映されているか (未反映なら **Critical**: 更新必須)

**新規スタック・新規アプリの場合:**

- [ ] ドキュメントのタイトル (# 見出し) がノード名として適切か
- [ ] 該当カテゴリの `README.md` (例: `docs/README.md` の入口テーブル) にリンクが追加されているか
- [ ] [document-writing.md](./document-writing.md) の「何を書くか」「何を書かないか」に準拠しているか

**既存スタック・既存アプリの変更の場合:**

- [ ] ドキュメントの記述が実装と乖離していないか (古い情報が残っていないか)
- [ ] 現在の実装を散文で説明する更新になっていないか (型 / lint / test で表現できるなら docs に書かない)

## ryan-graph (BQ) の整合性

ryan-graph は self-management の Product Graph 実体。`apps/graph/product/` でビルドし、`mcp__ryan-graph__*` で照会する。

- [ ] graph schema 変更時 (`apps/graph/product/src/schema/`) に migration 戦略が明記されているか
- [ ] `source` + `external_id` の UPSERT で重複ノードを作らない idempotency が保たれているか
- [ ] embedding 列の `mode: 'REPEATED'` が schema に明示されているか
- [ ] 公開済み content のみ取り込んでいるか (未公開 draft は除外、CLAUDE.md rule 8 と整合)
- [ ] X 過去 post / engagement / 関係性検索の path が `mcp__ryan-graph__*` 経由になっているか (xmcp 直叩きは投稿 / 直近 mentions のみ)
