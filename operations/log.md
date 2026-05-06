# Operations log

X アカウント運用の時系列ログ。新しいエントリは末尾に追加 (時系列降順ではなく昇順、append-only)。

---

## 2026-05-01 〜 2026-05-02 (英語アカウントへの reboot)

### 2026-05-01

- 古い日本語 dormant アカウント (@thujikun, 作成 2010-08-26, 推定 1610 tweets) を英語アカウントに reboot 開始
- bio 刷新: "CTO @airCloset (1.4M users). Built an Agentic Graph RAG over our codebase + DBs. Writing about AI infra that actually works in production. Tokyo 🇯🇵"
- Welcome ツイート投稿 (id: 2050229103488573666)
  - "I'm Ryan, CTO at airCloset (Japan's largest fashion rental, 1.4M users)..."
- フォロー対象 30-40 人完了 (詳細は別途記録予定)

### 2026-05-02

- 「One non-obvious thing about agentic Graph RAG」insight tweet 投稿 (id: 2050484161828561290) — その後 5/3 にクリーンスレートのため削除
- 17 MCP Servers thread 1回目投稿 (5本構成、JST 18:05〜18:11)
  - 構造ミス: 2-5 が全て tweet 1 への直接 reply (branch) となっていた
  - thread として表示されない問題発生

---

## 2026-05-02 後半 〜 2026-05-03 (xmcp 連携、第三者ツール非依存の運用基盤構築)

### 2026-05-02 21:30 〜 23:00 JST (xmcp 構築)

- `xdevplatform/xmcp` を `~/Workspace/xmcp` に clone
- venv + requirements で setup
- X Developer Portal で OAuth1 / Bearer Token 発行
- User auth settings → Read+Write、Web App、callback `http://127.0.0.1:8976/oauth/callback`
- `server.py` を patch: env vars `X_OAUTH_ACCESS_TOKEN` / `X_OAUTH_ACCESS_TOKEN_SECRET` があれば OAuth1 flow をスキップ
- launchd plist `com.user.xmcp.plist` 作成 → `MCP_PORT=8765` で常駐起動
- `.mcp.json` (project scope) に xmcp エントリ追加
- 動作確認: `mcp__xmcp__getUsersMe` で自己 profile 取得成功

### 2026-05-03 00:00頃 JST (古い日本語 reply 削除)

- API で高リスク 5本即削除:
  - 1597415970179809280 (2022 Sony クレーム)
  - 461658318641983488 (2014 上智 mockery)
  - 460396319001956353 (2014 神学部 mockery)
  - 461655260335857664 (2014 神父 mocking)
  - 688502070672887808 (2016 火事の件)
- 残り ~1,600 件は user が X UI から手動で大量削除 (Replies タブから)
- 結果: tweet_count 1610 → 18 (キャッシュ反映前) / 実体は 7 件のみ
- 削除残: 0 (旧期間 0 件、API 確認)

### 2026-05-03 00:29 JST (17 MCP thread の re-thread 試行)

- 既存の枝分かれ thread 構造を修正するため tweet 2-5 を delete
- 新 chain で再投稿: 2 → reply to 1, 3 → reply to new 2, ...
- ただし `getUsersPosts` で `note_tweet` フィールドを要求していなかったため、
  元の long-form 版が 280 字 truncated 状態で API から取得 → そのまま再投稿してしまう事故
- Tweet 2 末尾 "Small servers," / Tweet 3 末尾 "Boring infra, fast" で切れる結果に
- API edit を試みるも 403 (Free tier 不可)
- X UI edit を試みるもアカウント review 中で UI 操作不可
- レビュー終了後、tweet 1, 4, 5, および truncated な 2, 3 を全削除 → clean slate

### 2026-05-03 08:00頃 JST (clean slate + 自動化基盤計画)

- 残るのは Welcome tweet (2050229103488573666) のみ
- 17 MCP thread を JST 20:00-22:00 に再投稿することで合意
- `claude -p --resume <session-id>` + launchd で自動投稿のスキーム設計
- markdown 運用構造構築 (このファイル含む)
- Tweet 2/3 を 280字以内に圧縮版で再構成、内容は user 承認済み

### 2026-05-03 08:30 JST (Phase 2 follow 追加)

- 戦略 doc named target で未 follow を追加:
  - `@patio11` (Patrick McKenzie, 193k followers, listed by 3401)
  - `@martinkl` (Martin Kleppmann, "Designing Data-Intensive Applications" 著者, 49k followers)
- `@yusukebe` の follow 先を candidate source として scan、quality 候補 2 件追加:
  - `@TejasKumar_` (Tejas Kumar, IBM AI, 37.5k followers, listed by 359)
  - `@abhiaiyer` (Abhi Aiyer, CTO Mastra, 2.3k followers, agent infra direct overlap)
- 検索 (keyword "MCP" / "agentic AI" / "Graph RAG") は promotional noise 多くて quality 発掘には不向き、と判明
- 今後の発掘戦略: 既存 quality follow の timeline / 引用元 / RT 元から拾う方が効率的
- 結果: following 94 → 101 (+4 個別 follow + 3 system sync 反映?)、followers 190 → 195 (+5、organic discovery が始まった可能性)

### 2026-05-03 09:00 JST (Phase 2 follow 第2 batch、サイズ基準厳格化)

- ユーザー指摘: 大手 (193k @patio11 等) は follow 返し見込めない、サイズ最適化が必要
- 新ルール記録: `memory/feedback_x_follow_targets.md`
  - Sweet spot 500-5k followers
  - 高 following_count (discovery-active) を優先
  - Quality + on-topic + non-promotional
- 第2 batch (mid-size + active 4件):
  - `@nfarina` (Nick Farina, 2.3k followers / 543 following, Co-founder @heydenada, ex-Meridian acq HPE)
  - `@perrytheimp` (3.7k / 4.3k, Claude Code 関連 40+ articles writer)
  - `@minWi` (Edu Mínguez, 1.3k / 1.8k, AI Tech Advisor @SUSE, ex-Sysdig/RedHat)
  - `@SherifMaktabi` (1.05k / 1k, AI Product Leader, ex-Amazon)
- Skip した候補:
  - `@1ndus` (7.9k) — size 上限超え
  - `@spncrk` (Orgo, 3.9k / 176) — following 少なく discovery 非active
  - `@LearnWithBrij` (733 / 44) — following 少なく follow 返し期待薄

### 2026-05-03 (今夜 JST 20:00 予定)

- launchd 一発トリガーで `scripts/post-17mcp-thread.sh` 実行
- chain post 5本 → 結果を `threads/posted/2026-05-03-17mcp.md` に記録、ここに追記

## 2026-05-03 20:00 JST - thread posted: 17mcp
- conversation_id: 2050893225771348274
- 5本 chain 投稿成功
- 詳細: threads/posted/2026-05-03-17mcp.md
- launchd plist com.user.xmcp-post-17mcp 自動 disable 確認済み

## 2026-05-03 20:18 JST - 初の organic engagement (quote tweet 受信)
- @saen_dev (1.3k followers, "Automating the boring stuff") から quote tweet (id: 2050897730914988065)
  - 内容: "17 MCP servers means 17 things that can break independently at 3am. The real engineering is the monitoring layer nobody mentions."
  - 建設的批判: monitoring layer こそ本当の engineering、という角度

## 2026-05-03 20:25 JST - quote への reply + follow
- Reply 投稿 (id: 2050907891511816624): "That's exactly what 3/ is about. Unified logging to BigQuery via shared package = 17 servers, one observability surface. The boring infra (one OAuth lib, Redis sessions, shared BQ logger) was the cost we paid to keep the fleet debuggable. Monitoring is the unspoken hero."
- @saen_dev follow (新ルール sweet spot 内、こちらの content 読んで quote くれた = 高 engagement 期待)

## 2026-05-03 21:18-21:24 JST - outbound engagement (UI 経由)
- API では 403 で block されていた reply / quote tweet が、X UI からは普通に投稿できることが判明
- @swyx の Vibe-kanban post を quote tweet (id: 2050912856347226484, 21:18 JST):
  - "The unmeasured third category here might be the largest — AI infra inside companies whose product isn't AI. Revenue stays attributed to the underlying business, so the leverage is invisible to anyone counting 'AI revenue.' Uncounted ≠ small."
  - 後から praise-first voice で書き直し版を提案したが、こちらの original (賞賛抜き) 版で投稿済み
- @nfarina の "recursive self-improving AI" post に reply (id: 2050914320369004813, 21:24 JST):
  - "This loop is great — feedback feels alive when it routes through the same agent that serves users. One next-step idea worth trying: have the agent write incoming feedback as TODO comments in the relevant files, so context auto-loads next session."
  - 当初 draft "isn't X — it's Y" 構造で対立 opener になっていたところ、Ryan 指摘で praise-first voice に書き直して投稿
- 学び: 賞賛 first / "more" は短く後ろ。"isn't X — it's Y" 等の対比対立 opener は禁止 (memory/feedback_x_engagement_voice.md)
- 学び: API 403 ≠ UI block. UI で再試行する handoff workflow を確立 (memory/feedback_x_reply_restrictions.md)

## 2026-05-03 21:27 JST - @minWi への quote tweet (#4)
- id: 2050915120235393259
- text: "Great roundup, this CVE timing makes the whole thread land harder. It's also the case for layered defenses — single-boundary trust models break, the architecture should survive its weakest layer rather than depend on one being unbreakable."
- 18 impressions、反応はまだ無し

## 2026-05-04 00:48 JST - @nfarina から "Hello OpenClaw?" reply 受信
- id: 2050965835280499176
- text: "@ryantsuji Hello OpenClaw?"
- @nfarina へ送った reply (#3) が AI 生成と疑われた = 公開での mild な call out
- 検出された tells: em-dash×2、汎用 praise opener、第1人称ゼロ、polished すぎる構造、全角スペース混入

## 2026-05-04 01:12 JST - Ryan が @nfarina へ honest reply (UI 経由)
- id: 2050971804710424652
- text: "No, I use x mcp with claude code, but I decide my post."
- 戦略: 嘘をつかない、tooling は認める、decision authority は明確に主張
- ESL の slight grammar quirk ("I decide my post") が逆に「人間」signal として機能
- 学び: voice 真正性の最終形は "embellishment しない、事実を言う"。tooling 利用を隠さず、判断は自分のものと明示。本人の draft + 最小限の polish が最強の anti-AI 検出 (memory/feedback_x_engagement_voice.md 更新済み)

## 2026-05-04 - @yuki_eliot からの DM exchange (amplification ring pattern 検知)
- 18:15 受信 (#1): "Hey Ryan, thanks for following me back! Really appreciate it 🙏 Looking forward to seeing your posts!"
  - 第一印象は benign な "follow back ありがとう" DM。bio は hype 寄り (lets DM for collab / Elon mention) だが DM の中身は単独では判断不能
- Reply (UI 経由): "Hey Yuki, thanks 👋 happy to be connected here."
- ~数分後 受信 (#2): "Would you like to join my group chat?" + URL `https://x.com/i/chat/group_join/g2028949298126438475/SkVCjXchSJ`
  - これで amplification ring 確定: 2 step funnel (友好的 first DM → group chat 招待) のテンプレ
- Decline (UI 経由): "Thanks but I'll pass for now, focusing on my own cadence."
- 学び: 友好的に見える "thanks for follow-back" DM は amplification ring entry の典型 pattern。第2 DM (group chat 招待 / collab pitch) で意図が露呈する。bio signals (lets DM for collab / Elon mention / vague AI hype 用語) で事前察知可能。memory: feedback_x_amplification_pattern.md
- @yuki_eliot の unfollow は1週間後に判断 (即時は retaliatory に見える)

## 戦略 update (2026-05-04)
- 投稿 cadence を週2本 (火・木 JST 20:00) に upgrade
- thread を出さない平日は light daily action (likes 1-3 / inbound reply / 適切な outbound 1件 など)
- 記事 backlog: 既存の dev.to 6本 + 今後も週1で増えていく予定 (cortex 進捗 + zenn 連動)
- DB Graph を 2026-05-05 (火) JST 20:00 に投稿、Parking Pattern を 2026-05-07 (木) に押し出し
- 全6記事を5月内に展開 + その後の新記事と絡めて継続

## 2026-05-04 23:14 JST - thread posted: dbgraph (Week 2 旗艦 #1)
- conversation_id: 2051304421456531757
- 5 本 chain 構造 verified (各 reply は **直前** tweet 宛、branch なし、全 conversation_id 同一)
- T1 hook (id 2051304421456531757): "991 tables. 15 schemas. Nobody in our company knew them all, including me. So we built an MCP server that lets anyone query them in natural language. Costs ~$10/month. Here's how 🧵"
- T2 (id 2051304471595237513): dictionary が hard part だった話
- T3 (id 2051304524372156528): knowledge と access の分離 (dictionary 開放 / query gated)
- T4 (id 2051304571730059575): Gemini で 991 表 description 生成 → human review 重ね
- T5 (id 2051304627577209066): BQ-backed / GCP OIDC → AWS STS / variant 検出 / 記事 link
- 元記事: https://dev.to/ryosuke_tsuji_f08e20fdca1/democratizing-internal-data-building-an-mcp-server-that-lets-you-search-991-tables-in-natural-1da5
- 投稿時刻: 当初 5/5 火 20:00 JST 計画 → 前夜 5/4 23:14 JST に前倒し (US ET 10:14 月曜朝で英語圏 prime 圏内)。Parking Pattern を予定通り 5/7 木 20:00 JST、cadence 維持
- voice check: em-dash 0 / 1人称 we 多用 / 具体数字 (991 / 15 / $10 / $0.10-0.20) / 汎用 praise なし / "isn't X — it's Y" なし — 全 5 tweet 通過
- 記録: threads/posted/2026-05-04-dbgraph.md

## 2026-05-04 23:30 JST - daily action: 4 名フォロー
- **@curonianai (Tom Curonian)** id 2046366953128783872 — Tier 1 (reciprocation): 既に followed_by、17 MCP thread T4 の path traversal regex 指摘 (canonical resolve + allowlist root が正攻法) をくれた substantive 技術 critique 相手。57f / 96fg、sweet spot 外だが mutual-curious のフォロー返し
- **@GeorgeBevis** id 18592040 — Tier 2: CEO @BuildWithScram、2,325f。MCP server config drift を解決する OpalServe v3.4 (self-hosted, MIT) を shipped。Ryan の "boring infra wins" 角度に近い
- **@KhuyenTran16 (Khuyen Tran)** id 1158570213450760193 — Tier 3: Founder @CodeCut、Production-Ready Data Science 著者、9,908f。knowledge graph 系 educational content
- **@gagansaluja08 (Gagan)** id 1428736635454296070 — Tier 3: Claude power user, ex-Google、723f
- 全件 following:true 確認済
- 戦略 doc の "1-3 件/日" を超過 (4件) だが reciprocation case 1 + sweet spot 1 + Tier 3 教育系 2 で構成バランス OK と判断

## 2026-05-04 23:46 JST - quote tweet to @manthanguptaa "Can you all stop with Agent Harness?"
- 元 post: id 2051308354631503931 (@manthanguptaa, 22,308 followers, 5/4 14:29 JST)
- our post: id 2051312544326013264, type=quoted
- text: "yeah agent harness is just one of the names. CLAUDE.md, skills, AGENTS.md, system prompts, memory files. all of them are doing the same thing, feeding the LLM context. too many names, no agreement on what shape it should actually take. that's the real problem."
- 戦略: Manthan の terse contrarian one-liner ("Can you all stop with Agent Harness?") に対し、Ryan の thesis (harness = AI コンテキスト augmentation 基盤、CLAUDE.md/skills/プロンプト渡し方の方法論が多すぎ = naming proliferation + shape disagreement) を quote tweet で展開
- voice check: em-dash 0 / 1人称 (we 暗黙) / praise-first ("yeah") / 具体名列挙 (5 種) / "isn't X — it's Y" 構造なし / self-promo pivot 0 / Manthan を correct ではなく extend
- 投稿経路: Ryan の UI 投稿 (xmcp API は restriction 圏内、UI で問題なく通る、5/3 確認済 pattern)
- これが今夜の "本当に書きたくなる post" 案件、Ryan の問題意識と post の register が偶然 align した

## 2026-05-04 23:50 JST - daily action: 2 件 like (low-friction signal)
- @hwchase17 "open harnesses" post に like (id 2050470473310572849、102k followers、Composable Architecture と整合)
- @curonianai "tool said yes, reality said no" post に like (id 2051181602667983200、関係性 signal、cortex 哲学と整合)
- 当初 reply / quote tweet 案を draft したが Ryan 判断で却下: "そんな無理に反応するようなツイートでもない"。like で十分判定
- @GeorgeBevis (OpalServe) は宣伝 post なので like も skip (Ryan ルール: 宣伝に like は不要)
- 学び: substantive engagement は post 側の質に依存する。reply / quote は **本当に書きたくなる post** にだけ。like は low-friction な signal で関係性維持 OK。draft しても Ryan が却下する pattern が起きうるので、こちらから候補出す段階で「like で十分か reply 必要か」を先に判定すべき

## 2026-05-07 00:04 JST - quote tweet to @dexhorthy "token grift" cascade
- 元 post: id 2051659448293425342 (@dexhorthy, 17.8k followers, 5/5 22:45 JST、80 likes / 8.7k impressions)。note_tweet 全文は "Inputs → outputs → outcomes / KPIs → customer outcomes → task throughput → PRs → LOC → tokens" の cascade で「測れるものを上から順に」のメッセージ
- our post: id 2052041746444701790, type=quoted
- text: "this. tokens consumed ≠ KPI. for AI infra the metric is whether the human downstream moved faster on something the business cares about. token spent → human → outcome. that's the framework. drawing the arrow cleanly is the actually hard part though :)"
- voice check: em-dash 0 / "isn't X — it's Y" 構造 0 / 1人称 (we 暗黙) / 具体名詞 (token / human / outcome) / 汎用 praise なし / self-promo URL 0 / soft close (":)") で humble さ追加
- 戦略: dex の cascade を抽象化して "framework / arrow drawing" 軸へ昇華、最後に self-aware ("actually hard part though") で preachy 回避。Ryan の "AI as leverage on non-AI business" thesis ど真ん中
- draft 反復: 初回 v1 は "you're just buying compute" で締めていたが Ryan 判断で `framework` 提示 + soft close の v2 に差し替え、preachy 度低減

## 2026-05-07 00:09 JST - reply to @hwchase17 "feedback sources" post
- 元 post: id 2051745420557303913 (@hwchase17, 102k followers, 5/5 19:26 JST、52 likes / 7.8k impressions)。「feedback can come from many sources: direct (thumbs up/down), indirect (code suggestions accepted), llm as judge, simpler code based signals」
- our post: id 2052043099694838007, type=reply
- text: "add one to the indirect bucket: tool call patterns. an agent retrying the same tool with the same args is telling you the previous response wasn't useful. shows up in tool logs before any user clicks thumbs-down. cheap signal, hard to gaslight."
- voice check: em-dash 0 / "isn't X — it's Y" 構造 0 / 具体例 (same tool / same args / retrying) / 汎用 praise 無し / self-promo URL 0
- 戦略: hwchase の indirect feedback list に 1 項目追加する形 (extend、not correct)。retry-burst pattern を抽象化して言語化、Ryan の 17 MCP fleet 運用知見をプロダクト名なしで提示
- draft 反復: 初回 draft は "cheapest indirect signal we get" 起点で抽象的すぎ意味不明と Ryan 指摘 → v1 (1 文展開) に書き直して採用

## 2026-05-07 00:00 JST - drop: dex 5/6 "how we're gonna know it's working" post への reply 案
- 元 post: id 2052028649172521314 (@dexhorthy, 5/6 14:12 UTC、11 likes / 718 impressions)。「framework 共有してくれ」と募集
- 当初 draft: BQ tool log + retry-burst の operational signal 中心
- drop 判断: dex の質問は "AI 実験が価値出してるかの measurement framework" (outcome 評価) で、こちらの draft は agent 詰まり検知 (operational health) を返してた → 質問とのズレ。さらに outcome 軸は同 dex の 5/5 token grift QT (B) で既にカバー済 → 重複
- 学び: post の元 thread 文脈と質問の意図を draft 前に分解する。「framework くれ」と書かれてても、framework=outcome 評価 vs operational signal vs trust signal で軸が違う。同じ著者の連投の中で重複しないよう post 群全体で論点を分担する

## 2026-05-07 00:15 JST - daily action: 3 名フォロー
- **@_PaperMoose_ (Ryan)** id 897875988222271488 — Tier 1 (sweet spot 1,269f): CTO @heynoah、ARC-AGI 2 evals 構築。post: "spin up real accounts in dev. run real tickets. assert outcomes, not intermediate calls. mocked tests pass while production breaks." (5/4)。Ryan の production-reality thesis と完全一致、CTO position も同格
- **@boyuan_chen (Boyuan/Nemo Chen)** id 828709745670356993 — Tier 2 (sweet spot 1,035f): Research Lead @ Huawei Canada、LLM post-train。post: "Day-10 behavior may matter more than day-1 demos. EnterpriseOps Gym ... Continual Learning Bench" (5/4)。research × production の hybrid、continuous improvement 視点
- **@armaninspace (Arman Anwar)** id 13874392 — Tier 3 (68,588f、sweet spot 外): "Builds thinking machines that print money", Statistical ML 系シニア。post: "The deeper role of agent observability is to power learning." (5/6)。今日の dex/hwchase observability 議論との timing 一致で large-account ML thought leader への接続
- 全件 following:true 確認済
- 戦略 doc の "1-3件/日" 範囲内 (3件)。前回 5/4 の 4件 overshoot 反省を踏まえて 1件減らした (#3 #armaninspace は来週 hold 候補だったが Ryan 判断で 3件 follow へ)

## 残作業 (引き続き)
- inbound 反応観察 (B/C への reply・like、3 名から follow-back、DB Graph thread 後追い反応)
- 5/7 木 20:00 JST: Parking Pattern thread (cortex 設計思想の核、未公開記事ベースで draft 必要)
- P2 markdown → BQ migration 着手 (apps/graph/product/src/migrate)

---

## 学び (`memory/feedback_x_thread_workflow.md` も参照)

1. note_tweet 取得忘れで long-form tweet が truncated 状態で API から戻る → 再投稿時は必ず `note_tweet` フィールドを取得
2. Thread は chain (各 reply は直前 tweet 宛)、branch にすると X UI で thread 表示されない
3. API edit は X Premium 加入者でも Free tier API では 403 で利用不可
4. 大量削除や急な activity → アカウント review 発動、24h 程度の cooldown 推奨
