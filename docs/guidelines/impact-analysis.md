# 影響範囲分析ガイドライン

cortex の `docs/guidelines/impact-analysis.md` を、self-management の ryan-graph (BQ + embedding) を SSoT とする版に置き換える。

## 目的

PR の変更差分だけでなく、**変更すべきだったのに変更されていない箇所**を ryan-graph で特定する。

## 調査手順

### 1. 変更ノードの特定

PR の変更ファイル・関数を ryan-graph で検索し、qualifiedName を取得する。

```ts
mcp__ryan-graph__search_nodes({
  query: "<変更された関数名 or ビジネス的な説明>",
  kind: "<対象 node kind>",
})
```

`kind` は ryan-graph の node 種別 (`contents` / `decisions` / `learnings` / `topics` / `code_nodes` 等)。

### 2. グラフ走査 (構造的な接続)

各変更ノードから forward / backward 両方向にエッジを辿り、影響を受ける可能性のあるノードを列挙する。

```ts
mcp__ryan-graph__traverse({
  kind: "<node kind>",
  id: "<node id>",
  // direction: "both", max_depth: 3 等のパラメータがあれば指定
})
```

### 3. セマンティック検索 (機能的な類似性)

変更内容の `@graph-business` の内容や変更の意図を自然言語で記述し、類似機能を持つノードを検索する。グラフ上で直接接続されていなくても、同じパターンや同じ概念を扱うコードを発見できる。

```ts
mcp__ryan-graph__search_nodes({
  query: "<変更内容のビジネス的な説明>",
  // semantic search モード相当のオプションがあれば指定
})
```

活用例:
- 関数のバリデーションロジックを変更 → 同様のバリデーションを行う別関数を発見
- エラーハンドリングのパターンを変更 → 同じパターンを使う他の箇所を発見
- BQ テーブルのスキーマ変更 → 同じテーブルを異なるコンテキストで使う関数を発見
- TanStack Router 変更 → 同じ `getRouter` convention を使う他 app を発見

### 4. 修正漏れの判定

グラフ走査とセマンティック検索の結果から、PR の変更ファイルに含まれていないものを「修正漏れ候補」とする。

以下のパターンに該当する場合は指摘する:

| パターン | 説明 | 例 |
|----------|------|-----|
| **型・インターフェースの変更未伝播** | 型定義を変更したが、その型を参照する関数が未修正 | `Node` schema にフィールド追加 → parser が未対応 |
| **`@graph-connects` の不整合** | BQ / Firestore のカラム追加・リネームに対し、`@graph-connects` の説明が古いまま | テーブルにカラム追加 → upsert 関数の `@graph-connects` description が旧仕様 |
| **publisher / subscriber の片側変更** | Pub/Sub topic / event の publisher を変更したが subscriber が未対応 | publisher のメッセージ形式変更 → subscriber が旧形式のまま |
| **documented_by の乖離** | コード変更に対応するドキュメントが更新されていない | 新機能追加 → `docs/` の該当ドキュメント未更新 |
| **STACKS / DOMAINS enum 未更新** | 新規 stack / domain を使うファイルを足したが enum 未更新 | `@graph-stack new-stack` を使う file 追加 → `check-graph-tags.ts` の enum 未更新 (pre-commit で必ず落ちる) |
| **テストの未追従** | 変更された関数のテストファイルが PR に含まれていない | `extractDeclarationsFromFile()` 変更 → `parser.test.ts` 未更新 |
| **類似実装の未追従** | セマンティック検索で発見された同パターンのコードが未修正 | embedding 生成ロジック修正 → 別場所の類似処理が旧ロジックのまま |
| **Pulumi resource の片側変更** | Pulumi で binding を作ったが対応する app コードが旧 binding 名のまま | `cloudflare.WorkerCustomDomain` を Pulumi で追加 → `wrangler.jsonc` の `routes[]` 残置 (drift 元) |

### 5. 指摘しないケース

- 変更ノードから 4 ホップ以上離れた間接的な接続
- `@graph-connects none` のユーティリティ関数 (外部接続なし)
- 別 stack かつ別 deploy unit のノード (影響はあるが同一 PR で修正する必要がない場合)
- ドキュメント更新のみの PR
- セマンティック検索の類似度が低い (距離 0.4 以上) ノード

## ryan-graph 経由優先 (CLAUDE.md rule 8)

X 過去 post / 関係性検索 / engagement 履歴の影響範囲分析は **必ず ryan-graph 経由**で行う。xmcp (`mcp__xmcp-en__*` / `mcp__xmcp-jp__*`) の `getUsersPosts` / `getUsersMentions` / `searchPostsAll` 等を直接叩くのは:
- API rate limit + 月額料金が発生する
- BQ の方が安く、embedding semantic search が効く
- xmcp は **投稿実行 / 直近 mentions の差分取得 / 投稿後の post id 取得** に限定

ryan-graph に乗っていない情報を取りに行く場合のみ xmcp を呼ぶ。レビュー時はこの境界を確認する。

## レビュー時のチェック観点

- [ ] 影響範囲が ryan-graph で確認されているか (PR 説明で `mcp__ryan-graph__traverse` の結果や調査ログが言及されているか)
- [ ] 変更された型 / 関数 / schema の caller / consumer が同 PR で更新されているか
- [ ] 対応する docs (`docs/{category}/*.md` / `apps/{name}/README.md`) が更新されているか
- [ ] STACKS / DOMAINS enum が新値の使用前に更新されているか
- [ ] Pulumi resource を変更した場合、wrangler / その他ツール側に drift が残っていないか
- [ ] xmcp 経由で過去 post / 関係性を引いていないか (CLAUDE.md rule 8、ryan-graph 経由に置換)

## 違反時の重要度

- 修正漏れにより本番障害が起きる、または既存機能が壊れる場合は **Critical**。
- 修正漏れだが回避可能 / 局所的な不整合なら **Major**。
- 詳細は [severity.md](./severity.md) を参照。
