# auto-review

self-management の polling 型 PR 自動レビュー bot。`pnpm auto-review` で常駐起動し、`thujikun/self-management` の open PR を 60 秒ごとに走査して、新しい head_sha と新しい REQUEST_CHANGES marker comment を見つけたら Claude Code CLI で対応する。

cortex の `scripts/auto-review/` (webhook 駆動の本格 bot) を **polling 型 + 個人 1 人運用前提**に縮小コピーした構成。

## モード

| モード | trigger | 動作 |
|---|---|---|
| reviewer | open PR の `head_sha` が前回 review と違う | 6 観点 (Graph / Arch / Security / Test / Doc / Impact) で review コメントを posting |
| author | bot 自身の最新 verdict コメントが `<!-- VERDICT:REQUEST_CHANGES -->` | worktree で `claude -p` を spawn → 修正 → commit → push |
| merge | 直近の verdict コメントが `<!-- VERDICT:APPROVE -->` + 当該 head_sha 未 merge + CI 全 green (1 件以上 + 全 `bucket: pass / skipping`、0 件 PR は対象外) | `gh pr merge --squash --delete-branch`。CI 未 pass の継続で iteration cap (review / fix と共有) に達したら stalled |
| index | `origin/main` の SHA が前回 index 時点から動いた | detached process で `pnpm graph:build` を fire-and-forget kick。stdout/stderr は `~/.cache/self-management-auto-review/logs/graph-build-<TS>.log` にリダイレクト (5-30 分かかるので poll loop は block しないが、`git fetch origin main` の 1-5s だけ tick 冒頭に乗る) |

4 モードは **同じ poll loop で同時に動く** (`MODE` env なし)。webhook トンネル不要。

## 起動

```bash
# 初回のみ: bot 専用 OAuth token を発行 (subscription 範囲内、API 課金なし)
claude setup-token
# 出力された sk-ant-oat-... を .envrc.local に export
echo 'export CLAUDE_CODE_OAUTH_TOKEN="sk-ant-oat-..."' >> .envrc.local
direnv allow

pnpm auto-review
```

**`CLAUDE_CODE_OAUTH_TOKEN` を設定しないと interactive Claude Code が logout される**:
bot が spawn する `claude -p` は env に当該 token が無いと macOS Keychain の OAuth credential を読み、refresh token を rotation してしまう。interactive で使ってる Claude Code は旧 refresh token しか持っていないので、次の refresh で失敗 → logout。`setup-token` で発行した long-lived token を env で渡せば Keychain には触れず interactive と完全 isolate される。
bot 起動時に未 set だと warning を吐く。

env:

| 変数 | default | 用途 |
|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | (未設定で warning) | bot 専用 long-lived OAuth token (`claude setup-token` で発行)。**未設定だと interactive Claude が logout される** |
| `AUTO_REVIEW_REPO` | `thujikun/self-management` | 対象 repo |
| `AUTO_REVIEW_POLL_INTERVAL_MS` | `60000` | poll 間隔 (ms) |
| `AUTO_REVIEW_MAX_CONCURRENT` | `2` | 並行 job 上限 (vitest 競合を避けて控えめ) |
| `AUTO_REVIEW_MAX_ITERATIONS` | `10` | 同 PR の round-trip cap。**成功 review post / 成功 fix push / merge retry でのみ +1** (= round-trip 1 回で +2)。APPROVE で 0 reset。超えると stalled。**失敗 (timeout / parse failure / FIX_FAILED / push 検出失敗) では +1 しない** — それらは下の `*FAILURES` / `*BACKOFF_MS` の別系統で制御する |
| `AUTO_REVIEW_MAX_REVIEW_FAILURES` | `3` | 同 head_sha に対する review 失敗回数の cap。timeout / parse failure / throw が連続して cap 到達したら新 commit が来るまで skip。新 commit が push されれば SHA が変わって自動 reset |
| `AUTO_REVIEW_REVIEW_BACKOFF_MS` | `300000` (5 分) | review 失敗後、次 retry までの最小待機時間 (ms)。一過性 Claude flake の自然回復用 |
| `AUTO_REVIEW_MAX_FIX_FAILURES` | `3` | 同 commentId に対する fix 失敗回数の cap。新 review (= 新 commentId) が来るまで skip |
| `AUTO_REVIEW_FIX_BACKOFF_MS` | `300000` (5 分) | fix 失敗後、次 retry までの最小待機時間 (ms) |
| `AUTO_REVIEW_REPO_ROOT` | `process.cwd()` | git worktree base となるメイン repo path |
| `CLAUDE_TIMEOUT_MS` | `1800000` (30 分) | claude -p 1 回の timeout |

state は `~/.cache/self-management-auto-review/state.json` に atomic write (tmp → rename)。worktree は `~/.cache/self-management-auto-review/worktrees/` 以下 (macOS の `/private/var/folders/` auto-clean 回避)。

## anti-loop 5 層

| 層 | 対象 | 動作 |
|---|---|---|
| 1. reviewer dedup | `head_sha` | 成功 review 済 SHA は再 review skip (`lastReviewedSha`) |
| 2. author dedup | `commentId` | 成功 fix 済 commentId は再 fix skip (`lastAddressedCommentId`) |
| 3. NO_OP marker | reviewer prompt 内 Step 4 | 投稿前に直近の自分の review body と正規化比較 → 同一なら `<!-- VERDICT:NO_OP -->` を stdout に → script は `lastReviewedSha` だけ更新して post skip |
| 4. iteration cap (round-trip 用) | per-PR counter | **成功 review post / 成功 fix push / merge retry それぞれで +1** (APPROVE で 0 reset)。`MAX_ITERATIONS_PER_PR=10` (default) を超えたら `stalled: true` で当該 PR の全モード停止 (manual unblock は state.json 編集)。CI 未 pass / ciAllPass throw も iteration を進めて止まる |
| 5. failure cap + backoff | per-SHA / per-commentId counter | **失敗 (timeout / parse failure / FIX_FAILED / push 検出失敗 / throw)** 時に SHA / commentId は bookmark せず、`reviewFailureCount` / `fixFailureCount` を per-key で +1 し `lastReviewFailedAt` / `lastFixFailedAt` を記録。次 tick で (a) `*_FAILURE_BACKOFF_MS` (default 5 min) 未経過なら skip (b) `MAX_*_FAILURES` (default 3) 到達なら skip。それ以外は retry 可。新 commit / 新 review が来れば key が変わって counter 自動 reset。これにより一過性 Claude flake で永久停止を回避する |

正規化規則 (`dedup.ts`):
- VERDICT / BODY START/END marker 除去
- 「N 回目」「Round N」「第 N 回」「Iteration N」「イテレーション N」除去
- 6 桁以上の連続数字 → `<ID>`
- ISO8601 timestamp → `<TS>`
- 連続空白 → 1 つ、前後 trim
- 行番号 (`L854`) 等の短い数字は保持

## 出力フォーマット

bot の review コメントは以下の形:

```
<!-- AUTO_REVIEW_BODY_START -->
<レビュー本文 markdown>
<!-- AUTO_REVIEW_BODY_END -->
<!-- VERDICT:REQUEST_CHANGES -->   # または APPROVE
```

START/END marker で bot コメント識別 + 業務本文の抽出を兼ねる。VERDICT marker は author mode の trigger。

## ログ出力

stdout に `[HH:MM:SS] [+Xs] [scope] message` 形式で逐次出力。`scope` は `[poll]` / `[poll pr-N]` / `[review pr-N]` / `[fix pr-N]` / `[merge pr-N]` / `[index]` / `[job <id>]` のいずれかで grep / 解析しやすい。長時間 job (claude -p / graph:build) の進行状況を追えるよう、各段階で start / 完了 / duration を出す。

例 (1 tick + 1 review job):

```
[12:00:00] [+0s] [auto-review] starting (repo=thujikun/self-management, ...)
[12:00:00] [+0s] [poll] tick #1 begin
[12:00:01] [+1s] [index] origin/main moved (<none> → abc1234), kicking graph:build
[12:00:01] [+1s] [index] spawned pnpm graph:build (pid=12345) → ~/.cache/.../graph-build-2026-...log
[12:00:02] [+2s] [poll] 3 open PR(s)
[12:00:02] [+2s] [poll pr-13] sha=abc1234, branch=feat/foo, iterations=0
[12:00:02] [+2s] [poll pr-13]   reviewer: lastReviewedSha=<none> ≠ abc1234 → enqueue review
[12:00:03] [+3s] [poll pr-13]   1 bot verdict comment(s) found
[12:00:03] [+3s] [poll pr-13]   author: no REQUEST_CHANGES comment → skip
[12:00:03] [+3s] [poll pr-13]   merge: latest verdict is not APPROVE → skip
[12:00:03] [+3s] [poll] tick #1 end: enqueued=1 (review=1, fix=0, merge=0), skipped=0, queue=0, running=1
[12:00:03] [+3s] [job review-13-abc1234] picked from queue (running=1/2)
[12:00:03] [+3s] [review pr-13] start (sha=abc1234, repo=thujikun/self-management)
[12:00:03] [+3s] [review pr-13] creating read-only worktree at sha=abc1234...
[12:00:05] [+5s] [review pr-13] worktree ready: ~/.cache/.../pr-13-review-... (1.8s)
[12:00:05] [+5s] [review pr-13] spawning claude -p (prompt=4521 chars, cwd=...)...
[12:01:32] [+92s] [review pr-13] claude done (1m27s, exit=0, timedOut=false, stdout=12345 chars)
[12:01:32] [+92s] [review pr-13] parsed verdict=APPROVE, body=4521 chars → posting comment
[12:01:33] [+93s] [review pr-13] comment posted (820ms)
[12:01:33] [+93s] [review pr-13] state updated: lastReviewedSha=abc1234, iterations=0 (reset by APPROVE)
[12:01:33] [+93s] [review pr-13] removing worktree...
[12:01:33] [+93s] [review pr-13] done (total 1m30s)
[12:01:33] [+93s] [job review-13-abc1234] released (queued=0, running=0)
```

## ファイル構成

```text
scripts/auto-review/
├── poll.cli.ts        # entry: gh pr list loop + 4 mode dispatcher (review / fix / merge / index)
├── job-queue.ts       # 並行度 + per-PR mutex (type は "review" | "fix" | "merge")
├── review-job.ts      # reviewer 1 PR 分 (read-only worktree → claude → comment 投稿)
├── fix-job.ts         # author 1 PR 分 (PR branch worktree → claude → commit + push)
├── merge-job.ts       # APPROVE + CI green で gh pr merge --squash --delete-branch
├── index-job.ts       # origin/main SHA 動いたら detached pnpm graph:build を kick
├── claude.ts          # spawn claude -p、stdout から body / verdict 抽出 + per-job log file
├── worktree.ts        # git worktree 作成 / 削除 (read-only / branch 2 種)
├── prompt-review.ts   # review prompt builder (pure)
├── prompt-fix.ts      # fix prompt builder (pure)
├── eligibility.ts     # review/fix 再エンキュー判定 (pure: dedup + failure cap + backoff 窓)
├── dedup.ts           # body 正規化 + SHA-256 hash
├── log.ts             # `[HH:MM:SS] [+Xs] [scope] msg` 形式の logger + fmtDuration helper
├── state.ts           # ~/.cache/self-management-auto-review/state.json + StateMutex
├── *.test.ts          # 各 module の test (11 ファイル)
└── README.md
```

## scope NOT included

- alert-fix / annotation 自動運用 (Grafana / SPG なし)
- Slack 通知
- launchd 自動起動 (手動 `pnpm auto-review` で十分)
- claude `--resume` での session 継続 (個人 repo の小 PR では cold start 軽微)

## セキュリティ前提

bot は worktree cwd で `claude -p ... --dangerously-skip-permissions` を spawn する。worktree 内に閉じるとはいえ、Claude tool calls からは **`~/.claude/`、`~/.gitconfig`、その他 HOME 配下の任意ファイル** に access できる構成。これは:

- **個人 repo** (`thujikun/self-management`) を **個人 machine** で動かすことが前提
- 信頼できない PR (例: fork からの contribution) には適用しない (将来 fork に拡張する場合は worktree を別 user / sandbox 化する必要あり)
- `~/.claude/`, `~/.gitconfig`, `~/.ssh/` 等の sensitive ファイルが Claude session の context に含まれる前提で運用すること

cortex の auto-review も同 pattern (個人運用 + `--dangerously-skip-permissions`)。

## トラブルシュート

- **claude が timeout** (default 30 分): `CLAUDE_TIMEOUT_MS` で延ばすか、PR を細かく分割
- **iteration cap で stalled**: `state.json` の該当 PR エントリを削除すれば再開。再試行が必要な commentId が `lastAddressedCommentId` に bookmark されている場合も同じく state.json 編集で消す
- **失敗 cap で skip され続ける** (`review failure cap reached (3/3) for sha=...`): 同 SHA で 3 回連続失敗した状態。新 commit が push されれば自動回復するが、即時 retry させたい場合は `state.json` の該当 PR の `reviewFailureCount` / `fixFailureCount` を 0 に編集
- **claude が parse 失敗で何も投稿しない**: stdout を `~/.cache/self-management-auto-review/logs/claude-<scope>-pr<N>-<TS>.log` に保存しているので `cat` で確認。marker (`<!-- AUTO_REVIEW_BODY_START -->` 等) が出力されていなければ prompt 起因
- **worktree が残った**: `git worktree prune` + `rm -rf ~/.cache/self-management-auto-review/worktrees`
- **同じ指摘で無限ループ**: NO_OP 判定が機能していない可能性。`dedup.ts` の `normalizeBody` の正規化規則を見直し、本文中の差分要素が抜けていないか確認
- **fix が走ったのに push されていない**: fix-job は worktree HEAD ↔ origin/<branch> の SHA 比較で push 検証する。検証 fail なら failure cap + backoff (層 5) で skip 判定し、同 commentId の即時 retry を遮断する

## 関連

- [docs/review-guidelines.md](../../docs/review-guidelines.md) — レビュー判定基準
- [cortex/scripts/auto-review/](https://github.com/) — 元の cortex 実装 (webhook 駆動の本格版)
