# auto-review

self-management の polling 型 PR 自動レビュー bot。`pnpm auto-review` で常駐起動し、`thujikun/self-management` の open PR を 60 秒ごとに走査して、新しい head_sha と新しい REQUEST_CHANGES marker comment を見つけたら Claude Code CLI で対応する。

**polling 型 + 個人 1 人運用前提** の構成 (webhook トンネルを建てない簡素版)。

## モード

| モード | trigger | 動作 |
|---|---|---|
| reviewer | open PR の `head_sha` が前回 review と違う | 6 観点 (Graph / Arch / Security / Test / Doc / Impact) で review コメントを posting |
| author | bot 自身の最新 verdict コメントが `<!-- VERDICT:REQUEST_CHANGES -->` | worktree で `claude -p` を spawn → 修正 → commit → push |
| ci-fix | 直近の verdict が `<!-- VERDICT:APPROVE -->` + CI に `bucket: fail` の check あり (= code は通ったが CI 失敗) | worktree で `claude -p` を spawn し、failing job の log を `gh run view --log-failed` で取得して根本原因を診断 → 修正 → commit → push。FIX_FAILED で人間に委ねる選択も可 |
| merge | 直近の verdict コメントが `<!-- VERDICT:APPROVE -->` + 当該 head_sha 未 merge + CI 全 green (1 件以上 + 全 `bucket: pass / skipping`、0 件 PR は対象外) | `gh pr merge --squash --delete-branch`。「head branch is not up to date with the base branch」エラーは自動で `gh pr update-branch` を叩いて base ref を取り込む (= 新 SHA push → 次 tick で reviewer / merge 再評価) |
| update-branch | `mergeable=MERGEABLE` + `mergeStateStatus=BEHIND` (= conflict なしで base に遅れているだけ) | **script-only / no-AI / no-worktree** で `gh pr update-branch` を即実行。review verdict / CI 結果に関係なく proactively 走る。1 PR 1 SHA につき 1 回 (失敗時は backoff 1 分、cap 3 回) |
| conflict-fix | `mergeable=CONFLICTING` | worktree で `claude -p` を spawn し、focused prompt (conflict 解消 → merge commit → push のみ、6 gate 不要) で AI に解消させる。FIX_FAILED で人間に委ねる選択も可 |
| index | `origin/main` の SHA が前回 index 時点から動いた | detached process で `pnpm graph:build` を fire-and-forget kick。stdout/stderr は `~/.cache/self-management-auto-review/logs/graph-build-<TS>.log` にリダイレクト (5-30 分かかるので poll loop は block しないが、`git fetch origin main` の 1-5s だけ tick 冒頭に乗る) |

7 モードは **同じ poll loop で同時に動く** (`MODE` env なし)。webhook トンネル不要。

APPROVE 後の分岐は CI status で決まる: `pass` → merge / `fail` → ci-fix / `pending` → 次 tick まで wait。
update-branch / conflict-fix は review verdict と独立に走るので、reviewer が走っている間にも並行で branch 同期 / conflict 解消が進む。

## 起動

```bash
# 初回のみ: bot 専用 OAuth token を発行 (subscription 範囲内、API 課金なし)
claude setup-token
# 出力された sk-ant-oat-... を .envrc.local に export
echo 'export CLAUDE_CODE_OAUTH_TOKEN="sk-ant-oat-..."' >> .envrc.local
direnv allow

pnpm auto-review          # ← wrapper script (loop.sh) 経由、merge された新コードを自動反映
pnpm auto-review:once     # ← wrapper 無しの 1 回限り (開発時用)
```

## MCP scope 運用

bot の `claude -p` session が graph / xmcp 等を使えるよう、project-scope の `.mcp.json` (gitignored) を `worktree.ts` が bot worktree に copy + `claude.ts` が `--mcp-config` で明示 load する設計。

scope 分け方針:

| scope | 対象 MCP | 理由 |
|---|---|---|
| user (`~/.claude.json`) | 社内 HTTP MCP server (auth / 内部 product graph 系、複数) | 内部 URL / codename を public repo に commit しないため (具体名 / endpoint は private ops notes 参照) |
| project (`.mcp.json`、gitignored、bot worktree に copy) | `ryan-graph` (stdio、cwd 依存) / `xmcp-en` / `xmcp-jp` / `grafana-personal` / 他社内 HTTP MCP | stdio で `pnpm exec tsx apps/mcp/ryan-graph/...` を呼ぶ等 cwd 依存のもの + Ryan が個人 machine で常駐させてるもの |

新 machine で setup する手順 (1 回のみ):

```bash
# user scope: 社内 HTTP MCP server を ~/.claude.json に登録。
# 具体的な <NAME> / <URL> / <KEY> は private ops notes 参照、ここではコマンド形式のみ。
claude mcp add --scope user --transport http <NAME> <URL> --header "x-api-key: <KEY>"
# project scope: .mcp.json.example をベースに .mcp.json を作成、不要 entry を削除
cp .mcp.json.example .mcp.json
# 必要に応じて x-api-key 等の secret を埋める
```

`.mcp.json` を更新したあとは bot を再起動 (loop.sh は 30 分間隔で auto restart するので待つだけでも OK)。

### turbo cache の共有

bot は worktree を 1 session ごとに新規作成するため、default の `node_modules/.cache/turbo` だと毎回 cold cache で `pnpm build` / `pnpm test:coverage` を回すことになり 1 session 3-5 分の重荷だった。`claude.ts` が `TURBO_CACHE_DIR=~/.cache/self-management-auto-review/turbo-cache` を spawn env に inject することで、複数 worktree が同じ cache を共有して content-hash で再利用する。

呼出側 (`pnpm auto-review` の env) で `TURBO_CACHE_DIR` を既に設定していればそれを優先するので、user の好み path に変えたい場合は `.envrc.local` 等で override 可能。

### supervisor wrapper

`pnpm auto-review` は `scripts/auto-review/loop.sh` を経由する supervisor 構成:

1. 各起動前に `git fetch origin main` + `git reset --hard origin/main` で self-management(-review) clone を最新化
2. `pnpm install --frozen-lockfile` で node_modules を lockfile と同期 (新 dep を含む merge を反映)
3. `tsx scripts/auto-review/poll.cli.ts` を spawn
4. poll.cli.ts が **起動から 30 分経過 + queue idle** を満たすと self-exit (`process.exit(0)`)
5. wrapper が `sleep 2` してから 1 へ戻る → 新 main + 新 script + 新 deps で再起動

Node の import は同 process 内で再読込されないので、`pnpm auto-review` で merge した新機能 / fix は **次の自動再起動 (= 最長 30 分 + 進行中 job 完了待ち) で反映**。CTRL+C / SIGTERM は wrapper の trap で再起動せず exit する。

wrapper には **fast-exit cap** が組み込まれている: tsx が起動 <60s で exit する状態 (env 検証 throw / dep import 失敗 / token 不正 / install 失敗 等の startup failure mode) が 3 回連続したら supervisor 自身が `exit 1` で bail。anti-loop 5 層の最外周として「同 env で 2 秒待って再 spawn → 同じ throw を無限ループ」を有限回で止める。閾値は `AUTO_REVIEW_FAST_EXIT_THRESHOLD_SEC` / `AUTO_REVIEW_FAST_EXIT_MAX` で上書き可。

**`CLAUDE_CODE_OAUTH_TOKEN` を設定しないと interactive Claude Code が logout される**:
bot が spawn する `claude -p` は env に当該 token が無いと macOS Keychain の OAuth credential を読み、refresh token を rotation してしまう。interactive で使ってる Claude Code は旧 refresh token しか持っていないので、次の refresh で失敗 → logout。`setup-token` で発行した long-lived token を env で渡せば Keychain には触れず interactive と完全 isolate される。
bot 起動時に未 set だと warning を吐く。

env:

| 変数 | default | 用途 |
|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | (未設定で warning) | bot 専用 long-lived OAuth token (`claude setup-token` で発行)。**未設定だと interactive Claude が logout される** |
| `AUTO_REVIEW_REPO` | `thujikun/self-management` | 対象 repo |
| `AUTO_REVIEW_POLL_INTERVAL_MS` | `60000` | poll 間隔 (ms) |
| `AUTO_REVIEW_MAX_CONCURRENT` | `6` | 並行 job 上限。複数 PR を捌くため一気に同時実行。update-branch は worktree も AI もないので gate を食わずに混在可。vitest 競合などで詰まる場合は下げる |
| `AUTO_REVIEW_MAX_ITERATIONS` | `10` | 同 PR の round-trip cap。**成功 review post / 成功 fix push / 成功 ci-fix push / 成功 conflict-fix push それぞれで +1** (review → fix の round-trip 1 回で +2)。update-branch / merge 自体は iterations を触らない。APPROVE で 0 reset。超えると stalled。**失敗 (timeout / parse failure / FIX_FAILED / push 検出失敗) では +1 しない** — それらは下の `*FAILURES` / `*BACKOFF_MS` の別系統で制御する |
| `AUTO_REVIEW_MAX_REVIEW_FAILURES` | `3` | 同 head_sha に対する review 失敗回数の cap。timeout / parse failure / throw が連続して cap 到達したら新 commit が来るまで skip。新 commit が push されれば SHA が変わって自動 reset |
| `AUTO_REVIEW_REVIEW_BACKOFF_MS` | `300000` (5 分) | review 失敗後、次 retry までの最小待機時間 (ms)。一過性 Claude flake の自然回復用 |
| `AUTO_REVIEW_MAX_FIX_FAILURES` | `3` | 同 commentId に対する fix 失敗回数の cap。新 review (= 新 commentId) が来るまで skip |
| `AUTO_REVIEW_FIX_BACKOFF_MS` | `300000` (5 分) | fix 失敗後、次 retry までの最小待機時間 (ms) |
| `AUTO_REVIEW_MAX_CI_FIX_FAILURES` | `3` | 同 head_sha に対する ci-fix 失敗回数の cap。新 commit が来るまで skip |
| `AUTO_REVIEW_CI_FIX_BACKOFF_MS` | `300000` (5 分) | ci-fix 失敗後、次 retry までの最小待機時間 (ms) |
| `AUTO_REVIEW_MAX_UPDATE_BRANCH_FAILURES` | `3` | 同 head_sha に対する update-branch 失敗回数の cap。GH API rate limit / transient 5xx 対策 |
| `AUTO_REVIEW_UPDATE_BRANCH_BACKOFF_MS` | `60000` (1 分) | update-branch 失敗後、次 retry までの最小待機時間 (ms)。script-only で軽量なので短め |
| `AUTO_REVIEW_MAX_CONFLICT_FIX_FAILURES` | `3` | 同 head_sha に対する conflict-fix 失敗回数の cap。新 commit が来るまで skip |
| `AUTO_REVIEW_CONFLICT_FIX_BACKOFF_MS` | `300000` (5 分) | conflict-fix 失敗後、次 retry までの最小待機時間 (ms) |
| `AUTO_REVIEW_EXIT_AFTER_UPTIME_MS` | `1800000` (30 分) | 起動からこの時間経過 + queue idle で self-exit。wrapper script が `git reset --hard origin/main` + 再 spawn することで新コードを反映。0 を指定すると無効化 (`auto-review:once` 相当)。非数値 / 負数を指定すると起動時に fail-fast |
| `AUTO_REVIEW_FAST_EXIT_THRESHOLD_SEC` | `60` | wrapper の fast-exit 判定閾値 (秒)。tsx 起動からこの時間未満で exit すると fast-exit counter を +1。非数値 / 空 / 負数を指定すると起動時に `exit 2` で fail-fast |
| `AUTO_REVIEW_FAST_EXIT_MAX` | `3` | fast-exit を連続して許容する回数。到達したら supervisor が `exit 1` で bail (startup failure の無限再起動 loop 遮断)。非数値 / 空 / 負数 / 0 を指定すると起動時に `exit 2` で fail-fast |
| `AUTO_REVIEW_REPO_ROOT` | `process.cwd()` | git worktree base となるメイン repo path |
| `CLAUDE_TIMEOUT_MS` | `1800000` (30 分) | claude -p 1 回の timeout |

state は `~/.cache/self-management-auto-review/state.json` に atomic write (tmp → rename)。worktree は `~/.cache/self-management-auto-review/worktrees/` 以下 (macOS の `/private/var/folders/` auto-clean 回避)。

## anti-loop 6 層

| 層 | 対象 | 動作 |
|---|---|---|
| 1. reviewer dedup | `head_sha` | 成功 review 済 SHA は再 review skip (`lastReviewedSha`) |
| 2. author dedup | `commentId` | 成功 fix 済 commentId は再 fix skip (`lastAddressedCommentId`) |
| 2b. ci-fix dedup | `head_sha` | 成功 ci-fix 済 SHA は再 ci-fix skip (`lastCiFixedSha`)、新 commit を待つ |
| 3. NO_OP marker | reviewer prompt 内 Step 3 | 投稿前に直近の自分の review body と正規化比較 → 同一なら `<!-- VERDICT:NO_OP -->` を stdout に → script は `lastReviewedSha` だけ更新して post skip |
| 4. iteration cap (round-trip 用) | per-PR counter | **成功 review post / 成功 fix push / 成功 ci-fix push / 成功 conflict-fix push それぞれで +1** (update-branch / merge は iterations を触らない、APPROVE で 0 reset)。`MAX_ITERATIONS_PER_PR=10` (default) を超えたら `stalled: true` で当該 PR の全モード停止 (manual unblock は state.json 編集) |
| 5. failure cap + backoff | per-SHA / per-commentId counter | **失敗 (timeout / parse failure / FIX_FAILED / push 検出失敗 / throw)** 時に SHA / commentId は bookmark せず、`reviewFailureCount` / `fixFailureCount` / `ciFixFailureCount` を per-key で +1 し `last*FailedAt` を記録。次 tick で (a) `*_FAILURE_BACKOFF_MS` (default 5 min) 未経過なら skip (b) `MAX_*_FAILURES` (default 3) 到達なら skip。新 key が来れば counter 自動 reset |
| 6. supervisor fast-exit cap | wrapper (`loop.sh`) | tsx の起動 <`FAST_EXIT_THRESHOLD_SEC` (default 60s) での exit (env 検証 throw / dep import 失敗 / token 不正 / `pnpm install` 失敗 等) が `FAST_EXIT_MAX` (default 3) 回連続したら supervisor が `exit 1` で bail。「同 env で 2 秒待って再 spawn → 同じ throw を無限ループ」の最外周遮断 |

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
├── poll.cli.ts            # entry: gh pr list loop + 7 mode dispatcher (review / fix / ci-fix / merge / update-branch / conflict-fix / index)
├── job-queue.ts           # 並行度 + per-PR mutex (type は "review" | "fix" | "merge" | "update-branch" | "conflict-fix")
├── review-job.ts          # reviewer 1 PR 分 (read-only worktree → claude → comment 投稿)
├── fix-job.ts             # author 1 PR 分 (PR branch worktree → claude → commit + push)
├── ci-fix-job.ts          # ci-fix 1 PR 分 (PR branch worktree → claude が gh run view で failing log 取得 → 修正 → push)
├── merge-job.ts           # APPROVE + CI green で gh pr merge --squash --delete-branch
├── update-branch-job.ts   # BEHIND な PR を proactively `gh pr update-branch` で更新 (script-only / no-AI / no-worktree)
├── conflict-fix-job.ts    # CONFLICTING な PR を AI に conflict 解消させる (focused prompt、6 gate 不要)
├── index-job.ts           # origin/main SHA 動いたら detached pnpm graph:build を kick
├── claude.ts              # spawn claude -p、stdout から body / verdict 抽出 + per-job log file
├── worktree.ts            # git worktree 作成 / 削除 (read-only / branch 2 種)
├── prompt-review.ts       # review prompt builder (pure)
├── prompt-fix.ts          # fix prompt builder (pure)
├── prompt-ci-fix.ts       # ci-fix prompt builder (pure)
├── prompt-conflict-fix.ts # conflict-fix prompt builder (pure)
├── eligibility.ts         # review/fix/ci-fix/update-branch/conflict-fix 再エンキュー判定 (pure: dedup + failure cap + backoff 窓)
├── dedup.ts               # body 正規化 + SHA-256 hash
├── log.ts                 # `[HH:MM:SS] [+Xs] [scope] msg` 形式の logger + fmtDuration helper
├── state.ts               # ~/.cache/self-management-auto-review/state.json + StateMutex
├── loop.sh                # supervisor wrapper (git reset --hard origin/main → tsx → restart on self-exit)
├── *.test.ts              # 各 module の test
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

同パターンは個人運用 + `--dangerously-skip-permissions` 前提の auto-review bot で広く採られている。

## トラブルシュート

- **claude が timeout** (default 30 分): `CLAUDE_TIMEOUT_MS` で延ばすか、PR を細かく分割
- **iteration cap で stalled**: `state.json` の該当 PR エントリを削除すれば再開。再試行が必要な commentId が `lastAddressedCommentId` に bookmark されている場合も同じく state.json 編集で消す
- **失敗 cap で skip され続ける** (`review failure cap reached (3/3) for sha=...`): 同 SHA で 3 回連続失敗した状態。新 commit が push されれば自動回復するが、即時 retry させたい場合は `state.json` の該当 PR の `reviewFailureCount` / `fixFailureCount` を 0 に編集
- **claude が parse 失敗で何も投稿しない**: stdout を `~/.cache/self-management-auto-review/logs/claude-<scope>-pr<N>-<TS>.log` に保存しているので `cat` で確認。marker (`<!-- AUTO_REVIEW_BODY_START -->` 等) が出力されていなければ prompt 起因
- **worktree が残った**: `git worktree prune` + `rm -rf ~/.cache/self-management-auto-review/worktrees`
- **同じ指摘で無限ループ**: NO_OP 判定が機能していない可能性。`dedup.ts` の `normalizeBody` の正規化規則を見直し、本文中の差分要素が抜けていないか確認
- **fix が走ったのに push されていない**: fix-job は worktree HEAD ↔ origin/<branch> の SHA 比較で push 検証する。検証 fail なら failure cap + backoff (層 5) で skip 判定し、同 commentId の即時 retry を遮断する
- **APPROVE 済なのに merge されない / ci-fix が空回り**: CI に `bucket: fail` の check があると merge mode は走らず ci-fix mode が引き継ぐ。Claude が AI 判断で原因不明と判断したら `FIX_FAILED` で record (`ciFixFailureCount` 増加)。3 回連続失敗で同 SHA は skip され、新 commit を待つ。secret 不足など bot ローカルで再現不可能な失敗の場合は人間が secret を整備してから新 commit を push、または `state.json` の `lastCiFixedSha` / `ciFixFailureCount` を編集して再 attempt させる
- **PR が "head branch is not up to date" で merge できない**: 自動で `gh pr update-branch` が走るので、人間介入は通常不要。新 SHA で CI が再 run → 次 tick で再 merge attempt の round-trip に乗る。update-branch 自体が失敗するケース (conflict / API rate limit) は warn ログのみで state 不変、人間が手動で `gh pr update-branch <N>` or 手動 rebase + force-push が必要

## 関連

- [docs/review-guidelines.md](../../docs/review-guidelines.md) — レビュー判定基準
