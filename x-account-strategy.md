# X (Twitter) 英語アカウント運用プラン

## 1. 背景

### 現在地

- airCloset CTO として日本市場では一定の認知がある（Zenn 発信、CTO position）
- 技術的 content quality は世界レベルで先端
  - dev.to に 6 本の英語記事を蓄積済み（DB Graph、17 MCP Servers、Meeting Intelligence、Biz Graph、Sandbox MCP、Parking Pattern）
  - 海外事例（Uber、Notion、Glean、Microsoft）と比較しても、組織固有性 × 統合度 × 実装効率の3点で世界先端事例に位置する
  - CTO 1人で経営業務と並行して片手間で構築している事実が、CTO の働き方として希少な事例
- 一方、英語圏での個人プレゼンスはほぼゼロ
  - dev.to は SEO は強いが organic discovery が弱く、ほとんど読まれない
  - HN への submit は新規アカウント restriction で1本目が dead 扱いに
  - 英語圏 dev community との接点が無い

### 機会

- 「日本に AI infrastructure 先進事例の CTO がいる」という position は、英語圏でほぼ空席
- 2026 年は agentic AI / MCP の議論が活発化するフェーズで、production 事例の発信に追い風
- 日本人で英語圏に確立された position を持つ engineer は限られている（@yusukebe など）。先行者になれる余地が大きい
- Anthropic との関係性（Claude Code heavy user、MCP production 事例）が事例化の入口として活用できる

### 戦略的意義

英語圏でのプレゼンスは、複数のレイヤーで価値を生む：

- **採用**: 給与でリードできない日本企業が、仕事の先端性で世界レベル人材を採用する材料
- **事業ブランディング**: airCloset を「ファッションレンタル」から「AI infrastructure パイオニア」へと拡張する評価軸
- **個人ブランド**: 世界の AI engineering community での thought leadership position
- **事例化機会**: Anthropic、各種カンファレンス、Investor 経由の認知拡大ルートが開く

---

## 2. 目的

### Primary

英語圏 dev/CTO/AI engineering community における **個人プレゼンスの確立**。

具体的には：

- 6ヶ月後: 英語圏 technical Twitter で「日本の AI infrastructure 事例の人」として認知される
- 12ヶ月後: 英語圏 community で議論に普通に参加でき、reply に反応が来る position
- 18ヶ月後: カンファレンス登壇や英語メディア掲載のオファーが来る position

### Secondary

- HN / Reddit / 英語ブログメディアへの記事流入の起点
- 海外採用候補者・パートナー・投資家との接点
- Anthropic 等とのリレーション構築のエビデンス

### Non-Goals

- フォロワー数を最大化する（質より量）
- バズるツイートを狙う（短期 spike より長期積み上げ）
- 日本市場での認知拡大（これは Zenn・日本語 X で別途）

---

## 3. アカウント設計

### アカウント方針

10年以上前の dormant 日本語アカウントを **完全リブート** する形で英語化。新規作成より old account の年齢資産が活きる。

### プロフィール

- **ハンドル名**: 本名系（@rtsuji 等）。CTO position の個人ブランドを目指すため本名が筋
- **表示名**: Ryan Tsuji
- **bio**: 「CTO @airCloset (1.4M users). Built an Agentic Graph RAG over our codebase + DBs. Writing about AI infra that actually works in production. Tokyo 🇯🇵」（または同等の version）
- **固定ツイート**: 自己紹介 + 発信内容 + 言語ポリシー
- **profile 画像**: 既存ビジネス系のものを流用（または刷新）
- **location**: Tokyo / Japan

### 過去ツイートの扱い

10年以上前のツイートは技術的に削除不能（X 仕様）。全消し諦める。新しい英語ツイートを積み重ねて埋もれさせる方針。10年前のツイートを英語圏の人が掘る確率は実用上ゼロ。

---

## 4. 中核戦略

### 戦略の柱

1. **Quality content × Right timing × Active engagement** の3つを揃える
2. プロモーション・買収型グロースは使わない（英語圏 tech Twitter で逆効果）
3. 短期スパイクより長期積み上げ（6ヶ月単位の marathon）
4. organic engagement の質を algorithm に学習させる初期 6 週間を慎重に設計

### 投稿戦略

#### 既存記事の流通

dev.to の 6 記事を、X スレッドとして順次展開。

優先順位（HN / Twitter での刺さりやすさ順）：

1. **DB Graph MCP** — 数字フックが強い、フラッグシップ
2. **17 MCP Servers** — 全体像、規模感
3. **Parking Pattern** — 短くキャッチー、HN 系で拡散しやすい
4. **Sandbox MCP** — non-engineer enable の独特の角度
5. **Biz Graph** — 設計思想、長く議論される
6. **Meeting Intelligence** — 一般読者にも理解しやすい

#### 投稿ペース

新規アカウント初期は algorithm が「このアカウントは伸びる」と学習する必要がある。1日1本の連投より、1記事 + 数日の engage で 1サイクル。

- **Week 1**: 17 MCP Servers スレッド
- **Week 2**: Parking Pattern
- **Week 3-4**: Sandbox MCP
- **Week 5-6**: Biz Graph
- **Week 7-8**: Meeting Intelligence
- **DB Graph**: 適切なタイミングで再展開（日付未定）

各記事の間は、英語圏のアカウントとの engage（reply、quote、議論参加）を中心に活動。短い insight tweet も混ぜる。

#### 投稿時間

英語圏ターゲットなので、米国 ET 朝に当てる：

- **冬時間**: 日本時間 21:00-23:00
- **夏時間（現在）**: 日本時間 20:00-22:00

火曜〜木曜が engagement 高い傾向。金曜朝（米国時間）も悪くない。土日は engagement 落ちる。

#### スレッド構造

メイン記事は 5本構成のスレッドで投稿：

1. Hook（フック、対比 frame など）
2. Why（設計判断の理由）
3. How（実装の核心）
4. Lesson（実用的な教訓）
5. Closing + 記事 link

各ツイート 200-260 字。X の compose 画面の「Add another post」で全文準備して一括投稿。

### Engagement 戦略

#### Follow

Phase 1 で 30-40 人を follow。Agent / MCP / Engineering Culture の core メンバー優先。

主な対象：
- AI Engineering: @swyx, @simonw, @hwchase17, @jerryjliu0, @karpathy, @virattt, @yoheinakajima
- MCP / Anthropic: @AnthropicAI, @alexalbert__, @\_catwu
- Engineering Culture / CTO: @danluu, @patio11, @lethain, @charity, @mipsytipsy
- Database / Data Infra: @bcantrill, @martinkl, @andy_pavlo
- 日本人で英語圏成功事例: @yusukebe（研究対象）

Phase 2 以降、organic にタイムラインから発見した人を追加。

#### Engagement の作法

- 自分のスレッド投稿前後 30 分に、他人の投稿に reply 1-2 本（algorithm に「アクティブ」シグナル）
- reply は質重視。Ryan の experience を踏まえた具体的なもの
- 防御的にならない、批判的コメントにも建設的に
- 「+1」「this!」みたいな空 reply はしない

#### やってはいけないこと

- mass follow（spam 判定リスク）
- follow → unfollow の繰り返し
- 自分の content link を毎日貼る（self-promo に見える）
- 過剰な emoji、過剰なハッシュタグ
- 日本式の自虐文化を英語に持ち込む（弱く見える）
- promoted 投稿（英語圏 tech Twitter で逆効果）

### HN / Reddit / 他プラットフォーム連携

X のスレッド投稿と並行して：

- **HN**: karma が育ったら（5-10 程度から）別記事を投稿。今回 1本目 dead だった経験を踏まえ、火曜〜木曜の米国 ET 朝、Show HN なし、自分の Author コメントを即書く戦略
- **Lobste.rs**: invite が取れたら投稿候補
- **Reddit**: r/programming, r/MachineLearning, r/ExperiencedDevs（subreddit のルール要確認）
- **LinkedIn**: 英語圏 CTO/VP Eng 層向けに記事 summary を post

これらは X が安定してきた Phase 2 以降に展開。

### Anthropic 経由ルート

X / HN とは別の認知ルートとして、Anthropic への事例化打診：

- Anthropic Japan、または Anthropic DevRel に連絡
- 「Claude Code + MCP の production 事例として共有可能」と提案
- 採用される場合、登壇機会・記事掲載・カンファレンス招待が発生する可能性
- airCloset 側にもメリット（採用ブランディング、海外露出）、Anthropic 側にもメリット（顧客事例）

これは X の進捗と独立に進められる action。

---

## 5. 実行プラン

### Day 0（立ち上げ）

- [x] 過去日本語アカウントの整理（既存ハンドル/bio 刷新）
- [x] 英語 bio + 固定ツイート設定
- [x] 過去ツイート整理（削除可能なもののみ削除、残りは諦め）
- [x] follow 30-40 人完了

### Week 1

- [ ] 17 MCP Servers スレッド投稿（火/水の日本時間 20:00-22:00）
- [ ] 投稿後 30 分間 active
- [ ] 英語圏アカウントへの reply 2-3 本/日
- [ ] 反応の analytics チェック

### Week 2-8

- 1記事/週 のペースで残り 5 記事を順次展開
- 記事の間は engage 中心の活動
- 各記事後の analytics で何が刺さるかを学習
- 英語圏で議論が起きてる topics に follow-up tweet

### Month 3 以降

- HN への再挑戦（karma 育成完了後）
- Anthropic への事例化打診
- カンファレンス CFP 検討
- 英語ブログ（個人ブログ or Substack）の検討

### Month 6 振り返り

- フォロワー数: 1000-3000 が目標
- 海外からの reply / mention の発生有無
- HN front page 経験回数
- カンファレンス登壇または記事掲載のオファー有無

---

## 6. 振り返りと判断材料

### KPI（measurable）

- **フォロワー数**: 増加ペース（質より量ではないが、伸び続けてるかは指標）
- **Impression**: 各ツイートの英語圏での reach
- **Engagement rate**: 反応率
- **海外フォロワー比率**: profile 訪問者の地域

### Quality 指標（subjective）

- 英語圏の Influencer から reply / quote / mention される頻度
- HN / Reddit での記事拡散
- DM での連絡（採用、提携、登壇打診）
- カンファレンスや事例化のオファー

### 戦略見直しトリガー

- 3ヶ月経って KPI が想定の半分以下 → 戦略再考
- 何かが想定外に伸びた → そこに集中投下
- バーンアウト or 時間捻出が困難 → ペースダウン or 一時停止

---

## 7. リスクと対策

### リスク 1: 投稿が誰にも届かない

新規アカウントは algorithm が evaluate するまで reach が出ない。最初の数本が反応ゼロでも当然。

**対策**: 短期で諦めない。最低 2 ヶ月は active に運用してから判断。

### リスク 2: バーンアウト

経営業務と並行で X 運用は時間的負担。

**対策**: 1日合計 2-3 時間のキャップを設定。朝 + 夜の固定枠で運用。週末は休み OK。

### リスク 3: 過去ツイートの掘り起こし

英語圏で認知が広がった後、10年以上前の日本語ツイートが掘られるリスク。実用上低いが、政治的・思想的に問題のある投稿があれば事前確認。

**対策**: 過去ツイートを一度確認、明らかに問題ありそうなものは削除可能な範囲で対応。

### リスク 4: 英語圏 community の attack

規模の大きい account に絡んだとき、議論で叩かれることがある。

**対策**: 防御的にならず、建設的に対応。間違えたら認める。Ryan の Zenn のコメント返信スタイルを英語版で。

### リスク 5: 期待値ギャップ

6ヶ月で見えた results が想像より小さくて萎える可能性。

**対策**: 英語圏でのプレゼンス構築は marathon。Phase 1 (0-6 ヶ月) は基盤作りで visible result は限定的、と予め心構えする。

---

## 8. 参考と原則

### 原則

- **継続 > 完璧**: 1本の最適化より、毎週投稿することの方が価値ある
- **質 > 量**: フォロワー数より、relevant な人との関係性
- **organic > paid**: 買ったリーチは資産にならない
- **長期 > 短期**: バズより積み上げ

### 参考事例

- **@yusukebe**: 日本人で英語圏で確立した position の最も成功した例。投稿スタイル、engage 方法、ブランディングの参考に
- **@simonw**: ブログ + Twitter + ツール公開の組み合わせで thought leadership を確立した模範例
- **@swyx**: AI Engineer という用語を作って category leader になった事例

### 関連リソース

- HN guidelines: https://news.ycombinator.com/newsguidelines.html
- HN welcome: https://news.ycombinator.com/newswelcome.html
- 各種記事の dev.to URL: 別途管理

---

## 9. 進化と更新

このドキュメント自体も定期的に見直す：

- 1ヶ月後: 初期 results を踏まえて戦略調整
- 3ヶ月後: KPI レビュー、Phase 2 への移行判断
- 6ヶ月後: 全体振り返り、Phase 2 計画策定

戦略は固定ではなく、実データを見て柔軟に変える。
