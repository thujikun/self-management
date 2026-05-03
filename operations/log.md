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

## 残作業 (5/5 DB Graph 投稿に向けて)
- dev.to の DB Graph 英語版記事 URL を Ryan から受領
- cortex-product-graph で db-graph / mcp-db-graph / cortex-db-graph stack の最新数字 / facts pull
- 5本構成 thread draft 作成 → Ryan review
- launchd plist 仕込み (com.user.xmcp-post-dbgraph.plist、StartCalendarInterval Hour=20 Minute=0)

---

## 学び (`memory/feedback_x_thread_workflow.md` も参照)

1. note_tweet 取得忘れで long-form tweet が truncated 状態で API から戻る → 再投稿時は必ず `note_tweet` フィールドを取得
2. Thread は chain (各 reply は直前 tweet 宛)、branch にすると X UI で thread 表示されない
3. API edit は X Premium 加入者でも Free tier API では 403 で利用不可
4. 大量削除や急な activity → アカウント review 発動、24h 程度の cooldown 推奨
