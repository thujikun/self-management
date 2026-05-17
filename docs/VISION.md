# self-management Vision — 個人の知識を外部化する

## このドキュメントについて

self-management が目指す世界と、その実現に向けたアーキテクチャ思想。

設計方針と最新情報は [DESIGN.md](./DESIGN.md) を、個別機能の詳細は各サブディレクトリのドキュメントを参照。

---

## 1. 根本思想：個人の知識も人の頭の中に閉じ込めない

self-management は「**個人 (Ryan) の知識・思想・運用を外部化する**」 system である。

人は必ず:
- 過去に書いた / 言った / 決めた内容を忘れる
- 同じ判断を文脈別に何度もしないといけない
- 自分の voice を一貫させたいが、毎回ゼロから組み立てる
- アウトプット (記事、登壇、ツイート、レビュー) と思想の連続性を保つのが難しい

「気合い」「ノート術」「Notion」「Obsidian」は対症療法に過ぎない。**自分の認知の外側に、機械が読める形でナレッジを置く**ことが本質的な解。

scope を「Ryan というシステム」に絞って、知識外部化の哲学を適用する。

---

## 2. 三つの柱

### 2.1 ryan-product-graph — 確定的な思想の骨格

ryan-product-graph は「**Ryan の人格・思想・content・関係性**」を 1 graph に統合する。

```
従来のメモアプリ: 質問 → ベクトル検索 → 「類似した」テキストを返す（確率的）
ryan-product-graph: 質問 → グラフ走査 → 「関連する」構造を返す（確定的）
```

ノード種別 (初期):

- **person**: 人物 (Ryan 本人、関係する人々、登壇関係者)
- **content**: 発信物 (X tweet、Zenn/dev.to 記事、登壇スライド、ポッドキャスト、インタビュー)
- **decision**: 戦略・運用判断 (X 運用方針、技術選定、組織判断)
- **topic**: 思想テーマ (AI 時代の組織、フルスタック、Why over How、知識の外部化)
- **event**: 出来事 (発表、入社、リリース、メディア露出)

エッジ種別 (初期):

- `authored`, `replied_to`, `quoted`, `references`, `tagged`, `engaged_with`, `decision_about`, `derived_from`

詳細は [product-graph/README.md](./product-graph/README.md)。

### 2.2 Multi-agent — 役割分散のエージェント (将来)

将来的には:

- **post-agent**: 投稿 draft 生成 (voice 一貫、graph 参照、article backlog 利用)
- **engage-agent**: inbound reply / quote / DM の判別 + draft 提案
- **analyze-agent**: 投稿後 analytics 集約、KPI トラッキング
- **research-agent**: graph + web scan で記事ネタ・談話文脈を準備

各エージェントが Ryan-product-graph をベースに動作することで、コンテキスト窓を blow up させずに精度を保つ。

### 2.3 Context caching + voice modeling

**voice の安定** が個人運用の最大の難所。AI に raw で書かせると AI 検出される (実例: nfarina に "Hello OpenClaw?" と call out された)。

対策の方向:

1. Ryan の過去 corpus (Zenn / dev.to / X 自筆部分) を構造化して保管
2. draft 段階で「Ryan voice」 retrieval を強制
3. AI が draft → Ryan が rough 修正 → AI が grammar 最小修正、のループが現状最強の anti-AI 検出 voice

---

## 3. AI を信じない、仕組みで守る

| レイヤー | 品質担保 | AI 依存 |
|----------|----------|---------|
| 関連 content の特定 | graph 走査 | なし (logic) |
| voice 一貫性 | corpus retrieval + voice rule lint | 間接 |
| 投稿前 review | quality gate (memory rules check) | 間接 |
| 投稿実行 | API 呼び出し (規定の playbook 通り) | なし |
| 投稿後 analytics | 機械的に集計 | なし |

唯一の AI 依存ポイントは「draft 生成」 と 「自然言語 query 解釈」。前後をロジックで固める。

---

## 4. 自律運用の到達点

```
人間が関与: 体験設計 (何を発信するか、誰と話すか、どの場に立つか)
        ↓
graph 参照 + multi-agent: draft 生成、engagement 判別、analytics 集約
        ↓
quality gate: voice / 戦略 doc 整合性チェック
        ↓
投稿 / engagement 実行: 自動
        ↓
graph 更新: 自動 (post 結果、reply 受信、follower 変化)
```

最終形: **Ryan は週1で「今週何を発信したいか」を決めるだけ**、 残りは self-management が回す。

---

## 5. self-management の position

| 軸 | self-management |
|----|-----------------|
| scope | Ryan 個人の content+思想+engagement |
| ノード規模 | 数百 → 数千 |
| 主用途 | 個人発信 + 思想保管 |
| AI 出力先 | 投稿 / 記事 / 返信 |
| voice 課題 | large (個人 brand) |
| 公開範囲 | content は public、graph は private |

---

## 6. 将来のアーキテクチャ進化

### 6.1 graph の自動拡張

X / Zenn / dev.to の RSS / API watch で新規 content を自動 ingest。手動エントリは決定 / 思想 only に絞る。

### 6.2 voice retrieval

Ryan の自筆部分のみで構成された embedding store。draft 生成時に "Ryan voice" の出力分布に強く制約する。

---

## 7. 設計原則

1. **AIを信じない、仕組みで守る** — graph 走査、テスト、lint、retrieval で品質を担保。
2. **ロジックで済むことに AI を使わない** — 関連 content の特定はグラフで、AI ではない。
3. **知識は人の外に置く** — Slack のメモ・X の発信・Zenn の記事を自然に蓄積、意識的なドキュメント作成依存しない。
4. **共通パターンで展開する** — Multi-Agent × Context Caching × Agentic Loop を個人 scale で展開。
5. **品質基準は妥協しない** — voice 一貫性、戦略 doc 整合性、apolicies 遵守。

これは個人運用にもスケールする。
