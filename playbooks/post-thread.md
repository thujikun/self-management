# Playbook: Thread 投稿

## 役割

事前に `threads/<name>.md` で確定された thread を X に投稿し、結果を記録する。

## 前提

- thread の内容は人間が承認済み（このplaybookは内容の判断はしない）
- 各 tweet は 280字以内に収まっている (note_tweet 不要)
- 投稿先は @ryantsuji (id: 183196464)
- xmcp が `http://127.0.0.1:8765/mcp` で稼働中

## 手順

### 1. thread 内容の読み込み

```
Read /Users/ryan/Workspace/self-management/threads/<name>.md
```

各 Tweet 1/5, 2/5, ..., 5/5 の本文を抽出 (markdown のコードブロック内)。

### 2. Tweet 1 投稿

```
mcp__xmcp__createPosts(text=<tweet 1 本文>)
→ 戻り値の id を保存 (T1_ID)
```

### 3. Tweet 2-5 を chain 投稿

各 tweet について **直前の tweet ID** に reply する形で:

```
mcp__xmcp__createPosts(
  text=<tweet 2 本文>,
  reply={"in_reply_to_tweet_id": "<T1_ID>"}
)
→ T2_ID を保存

mcp__xmcp__createPosts(
  text=<tweet 3 本文>,
  reply={"in_reply_to_tweet_id": "<T2_ID>"}
)
→ T3_ID を保存

... 5 まで
```

⚠ 重要: reply は必ず**直前の tweet** 宛 (chain)。root に向ければ branch (≠ thread) になる。これは過去事故の主因。

### 4. 構造検証

```
mcp__xmcp__getPostsById(id=<T5_ID>, tweet.fields=[referenced_tweets])
→ referenced_tweets[0].id == T4_ID であること確認
```

5本全てを順に検証してもよい (推奨)。

### 5. 結果保存

`/Users/ryan/Workspace/self-management/threads/posted/<YYYY-MM-DD>-<short-name>.md` に書き出し:

```yaml
---
thread_name: <short-name>
posted_at: <ISO 8601>
conversation_id: <T1_ID>
tweet_ids:
  - "1": <T1_ID>
  - "2": <T2_ID>
  - "3": <T3_ID>
  - "4": <T4_ID>
  - "5": <T5_ID>
source: threads/<name>.md
---
```

`/Users/ryan/Workspace/self-management/operations/log.md` (local-only / .gitignored、Ryan ローカル環境にのみ存在) に追記:

```
## <YYYY-MM-DD HH:MM JST> - thread posted: <short-name>
- conversation_id: <T1_ID>
- 5本 chain 投稿成功
- 詳細: threads/posted/<file>.md
```

### 6. 失敗時

- HTTP 4xx/5xx が返った場合は中断、`operations/log.md` (local-only / .gitignored、Ryan ローカル環境にのみ存在) にエラー記録、人間に通知
- chain 途中で失敗した場合、すでに投稿済みの tweet は残る → 削除するか手動で続けるか人間判断
- 投稿成功したが構造検証で失敗 (branch 状態) → 該当 tweet を delete + 再 chain post

### 7. 投稿後 30分の active engagement

別 playbook (`playbooks/post-engagement.md`) に従う。今夜の17 MCP 分は最初の運用なのでスキップでも可。
