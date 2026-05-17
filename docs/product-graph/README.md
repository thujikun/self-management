# ryan-product-graph (3 graphs)

Ryan の人格・content・思想・関係性 + self-management 自身のコード/インフラを統合する **3 graph 構造**。目的別に 3 つのサブグラフに分離。

## 思想

### なぜ作るのか

個人の発信・思想・engagement は時間とともに散逸する:

- X tweet は流れる、自分のだけは検索しにくい
- Zenn / dev.to は SEO は良いが「自分が言ったこと」の time-series が見えない
- 登壇 / podcast は public だが構造化されていない
- 過去の決定 (X reboot 戦略、技術選定の理由、人間関係) は本人が忘れる
- self-management 自身の release 履歴も散逸する

これらを **graph に統合** すれば、自分の発信の連続性・思想の進化・人間関係の history・コード変更の履歴をすべて辿れる。

### 構成サマリ

| | ryan-product-graph |
|---|---|
| scope | 個人 (Ryan) |
| BQ dataset | `ryan` (`ryan-self-management` プロジェクト) |
| graph 数 | **3** (product / release-note / personal) |
| MCP server | (将来) `mcp-ryan-product-graph` |

## 3 graph 構造

```
+----------------------+      +-------------------------+      +----------------------+
|   product-graph      |<---  |  release-note graph     |  --->|   personal-graph     |
|  (self-management の |      |  (changelog 時系列)    |      |   (Ryan 本人)        |
|   code / db / docs)  |      |                         |      |                      |
+----------------------+      +-------------------------+      +----------------------+
        ^                                ^                              ^
        |  product_graph_edges           |  release_edges               |  personal_edges
        |                                |                              |
        | (in_domain, calls, queries…)   | (tagged_with_domain,         | (authored, follows,
        |                                |  references, derived_from)   |  replied_to, quoted…)
```

cross-graph edges は **source 側のグラフの edges table** に格納:
- release_note → product_graph_node (Domain) → `release_edges`
- content → product_graph_node (Function) → `personal_edges`
- decision → release_note → `personal_edges`

### 1. product-graph (`ryan.product_graph_*`)

self-management mono-repo 自身の technical structure (db-graph 含む)。

**ノード種別** (single table、`node_type` discriminator):

```
Function, Module, Class                 # コード
ApiEndpoint, Page, FirestoreCollection
BigQueryTable, BigQueryView, BigQueryDataset
CloudRunJob, CloudRunService, PubSubTopic
CronSchedule, SlackBot                  # インフラ・boundary
Table, Column, Schema                   # DB schema (db-graph 相当)
Document                                # docs/
Domain                                  # source code domain (e.g. "graph", "x-runtime")
Stack                                   # Pulumi stack
```

**エッジ種別**:

```
calls, queries, reads_from, writes_to, publishes, triggers
in_domain, in_stack
has_table, has_column
documented_by
```

### 2. release-note graph (`ryan.release_*`)

self-management 自身の changelog を時系列 graph 化。

**ノード種別**: `release_notes` のみ (single table、discriminator なし)

**エッジ種別** (`release_edges` table):

```
derived_from           # release_note → release_note (前 release との関係)
tagged_with_domain     # release_note → product_graph_node (kind=Domain)
references             # release_note → product_graph_node (具体的に何が変わったか)
affects                # release_note → product_graph_node (kind=Stack)
about_event            # release_note → event (関連 event)
```

例: 「5/3 の 17 MCP thread 投稿 release」が `x-runtime` domain に属し、`scripts/post-17mcp-thread.sh` (Function node) を refers するエッジを張る。

### 3. personal-graph (`ryan.persons` / `ryan.contents` / ...)

Ryan の人格・content・思想・関係性 + X 関係 (follow / reply / quote / DM)。

**ノード種別** (per-type tables):

| table | role |
|---|---|
| `ryan.persons` | 人物 (Ryan 本人 + フォロワー / フォロー者 / reply 主 / メディア / 関係者) |
| `ryan.contents` | X tweet / X DM / Zenn / dev.to / 登壇 / podcast / interview。`source` で discriminate |
| `ryan.decisions` | 戦略 / 運用判断 |
| `ryan.topics` | 思想テーマ (Why over How / 知識の外部化 / AI as leverage) |
| `ryan.events` | 発表会 / 入社退職 / メディア露出 |

**エッジ種別** (`personal_edges` table):

```
authored               # person → content / decision
replied_to             # content → content (X reply)
quoted                 # content → content (X quote)
references             # content → any (cross-graph 含む)
follows                # person → person (X follow)
engaged_with           # person → content (like / view / DM 反応)
tagged                 # topic → content / decision
decision_about         # decision → any (cross-graph 含む)
mentioned_in           # person → content
participated_in        # person → event
```

## BQ tables 全体 (10)

dataset: `ryan` (location: `asia-northeast1`)

| graph | tables |
|---|---|
| product-graph | `product_graph_nodes`, `product_graph_edges` |
| release-note | `release_notes`, `release_edges` |
| personal-graph | `persons`, `contents`, `decisions`, `topics`, `events`, `personal_edges` |

合計 10 tables。schema TS 定義 (SSoT): [`apps/graph/product/src/schema/`](../../apps/graph/product/src/schema/)

### 設計判断: 非対称 schema

- **product-graph**: `1 nodes table + node_type discriminator` style。新 type が頻出する見込み (Function/Module/...が増える) ため拡張性重視。
- **personal-graph**: per-type tables で型固有 column を REQUIRED にする。type が固定 (person/content/decision/topic/event)、各 type のクエリ頻度が高い。

### 設計判断: edges polymorphic

各 edges table は src/tgt を `<table_name>` + `<id>` で polymorphic 参照。例:

```
release_edges:
  edge_id: <uuid>
  edge_type: tagged_with_domain
  src_kind: release_notes
  src_id:   <release_note_id>
  tgt_kind: product_graph_nodes
  tgt_id:   <node_id of Domain="x-runtime">
  created_at: ...
```

src_kind / tgt_kind の値は `NODE_TABLES` に固定 (TS で型付け)。

## X 関係性の格納

| 質問 | クエリ |
|---|---|
| 誰が私をフォロー? | `personal_edges WHERE edge_type='follows' AND tgt_kind='persons' AND tgt_id='<ryan>'` |
| 私がフォローしてる人? | `personal_edges WHERE edge_type='follows' AND src_id='<ryan>'` |
| この tweet への reply? | `personal_edges WHERE edge_type='replied_to' AND tgt_id='<tweet_id>'` |
| @nfarina との conversation? | `contents WHERE source='x'` + `metadata.conversation_id='<id>'` + `personal_edges` の replied_to |
| DM 履歴? | `contents WHERE source='x' AND JSON_VALUE(metadata, '$.subtype')='dm'` |

`follows` edge の `properties`:
```json
{ "source": "x", "first_observed_at": "...", "last_observed_at": "..." }
```

時間遷移の細粒度 (誰がいつ unfollow したか) は当面持たない。必要になったら `events` 化。

## 命名 / 規約

- node ID (`person_id`, `content_id`, `release_note_id`, `node_id` etc.): UUIDv7 推奨 (timestamp 順 + unique)
- `body_md`: markdown 完全保管 (front-matter 除く)
- `body_summary`: AI 生成、~200 字 ja / 200 chars en、1-2 sentences (embedding 検索の input)
- language は metadata に格納 (各 row には持たない)
- 全テーブル `metadata` JSON column を持つ (platform 固有 / type 固有の補助 attrs を全部ここに)

## ビルド・運用パイプライン (将来構想)

```mermaid
flowchart LR
    X[X API]              --> Ingest[ingest pipeline]
    Zenn[Zenn RSS]        --> Ingest
    DevTo[dev.to API]     --> Ingest
    Markdown[既存 markdown] --> Migrate[bulk migration]
    Code[code @graph-* タグ] --> ParseCode[code parser]
    ReleaseLog[CHANGELOG] --> ParseRelease[release parser]
    Ingest    --> BQ[(BigQuery: ryan dataset)]
    Migrate   --> BQ
    ParseCode --> BQ
    ParseRelease --> BQ
    BQ --> MCP[mcp-ryan-product-graph (将来)]
    MCP --> CC[Claude Code / claude -p]
    CC --> Output[X 投稿 / 記事 draft / engagement reply]
```

初期 phase は markdown を migrate → BQ load → claude -p から query。API watcher / MCP server / code parser は後続 phase。

## 実装ロードマップ

| Phase | 内容 |
|---|---|
| **P1** ✅ | schema 定義 + BQ table 作成 script (TS) |
| **P2** | 既存 markdown (operations/log.md, threads/, x-account-strategy.md, memory/) を node 化して BQ load |
| **P3** | claude -p 用 read CLI (BQ query → JSON 出力) |
| **P4** | X API ingest pipeline (post / engagement / follower 変化を BQ append) |
| **P5** | code @graph-* タグ + parser で product-graph を自動生成 |
| **P6** | MCP server (Cloud Run) を立てる、`.mcp.json` に登録 |
| **P7** | voice retrieval / corpus 学習 → 自律 draft 生成 |

## 関連 doc

- [DESIGN.md](../DESIGN.md) — 全体設計方針
- [VISION.md](../VISION.md) — 長期ビジョン
- [`apps/graph/product/`](../../apps/graph/product/) — schema TS + build / migrate scripts
