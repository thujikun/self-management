#!/usr/bin/env bash
#
# auto-review process supervisor。
#
# - 各起動前に `git fetch origin main` + `git reset --hard origin/main` で local clone を最新化
#   (self-management-review は観察者 clone 前提。local 変更があれば消える、それが intended)
# - 続いて `pnpm install --frozen-lockfile` で node_modules を lockfile と同期。
#   merge された PR が新 dep を追加していた場合、reset 後の source は新版・node_modules は
#   旧版という skew が生じ、tsx が import resolve に失敗して crash する。install を挟むことで
#   「merge した新機能 / fix が次回再起動で反映」contract を dep-touching 変更でも維持する。
#   lockfile 変更なしなら ~1-2s の no-op に近い
# - tsx poll.cli.ts を実行
# - poll.cli.ts が exit 0 で抜けたら ~2 秒 sleep して再起動 (= 「30 分 + idle」での self-restart 経路)
# - poll.cli.ts が非 0 で抜けたら同様だが warn を出す (debug 用)
# - SIGINT / SIGTERM (Ryan の CTRL+C 含む) は trap で吸って exit、再起動しない
#
# Fast-exit cap (anti-loop 最外周):
#   env 検証 throw / dep import 失敗 / token 不正 / state.json 破損 等の startup failure mode は
#   `tsx poll.cli.ts` を起動 <60s で exit させ、wrapper が 2 秒待って同 env で再 spawn → 同じ
#   failure を繰り返す = 無限再起動 loop。連続 N 回 (default 3) 短命 exit したら supervisor 自身が
#   exit 1 で bail する。`AUTO_REVIEW_EXIT_AFTER_UPTIME_MS=60000` 等での正常 self-exit は
#   uptime >= 閾値 で counter が reset されるため通常運用は影響を受けない。install 失敗で
#   tsx をそもそも起動しなかった iteration も同じ counter を進めることで、install 永久失敗も
#   有限回で止まる。
#
# 想定 cwd: self-management(-review) repo root
#
# Node の import は再読込されないので、新 main を反映するには process を作り直す必要がある。
# このループで「30 分 + idle → poll が自発的に exit → loop が fresh git + fresh node で起動」を実現

set -uo pipefail

# 起動 <FAST_EXIT_THRESHOLD_SEC 秒での exit を「fast exit」として counter を +1 し、
# FAST_EXIT_MAX 回連続到達で supervisor 自身が bail する。env で上書き可。
#
# `${X-default}` (colon なし) を使うことで Node 側の `?? default` semantics
# (undefined のみ fallback / 空文字は素通り) と揃える。空文字も regex に流して
# fail-fast 経路に乗せる目的。
FAST_EXIT_THRESHOLD_SEC="${AUTO_REVIEW_FAST_EXIT_THRESHOLD_SEC-60}"
FAST_EXIT_MAX="${AUTO_REVIEW_FAST_EXIT_MAX-3}"

# 非数値 / 空 / 負数を許すと bash の `[ N -lt X ]` / `[ N -ge X ]` が test 失敗 (rc=2)
# となり、`set -e` 無効 (`set -uo pipefail` のみ) のため supervisor は止まらず if が
# false 扱いで通過する。結果 fast-exit counter が増えず anti-loop 最外周 (層 6) が
# silently 死ぬ (例: `THRESHOLD_SEC=abc` で永久再起動)。逆に `MAX=-1` を許すと
# 初回 fast exit (counter=1) で `1 -ge -1` が true → 即 bail で通常運用が止まる。
# `MAX=0` は「常時 bail」設定で有効ユースケースが無いので不正扱い (anti-loop を
# 無効化したいなら supervisor を経由しない `pnpm auto-review:once` を使う)。
# 「anti-loop 制御に絡む env は fail-fast」を全 control plane に適用する invariant。
if ! [[ "$FAST_EXIT_THRESHOLD_SEC" =~ ^[0-9]+$ ]]; then
  echo "[auto-review-loop] AUTO_REVIEW_FAST_EXIT_THRESHOLD_SEC must be a non-negative integer (got: '$FAST_EXIT_THRESHOLD_SEC')" >&2
  exit 2
fi
if ! [[ "$FAST_EXIT_MAX" =~ ^[0-9]+$ ]] || [ "$FAST_EXIT_MAX" -eq 0 ]; then
  echo "[auto-review-loop] AUTO_REVIEW_FAST_EXIT_MAX must be a positive integer (got: '$FAST_EXIT_MAX')" >&2
  exit 2
fi
FAST_EXIT_COUNT=0

STOP=0
trap 'STOP=1; echo "[auto-review-loop] received signal, stopping after current iteration"; exit 130' SIGINT SIGTERM

while [ "$STOP" -eq 0 ]; do
  echo "[auto-review-loop] $(date '+%H:%M:%S') sync to origin/main..."

  SETUP_OK=1
  if ! git fetch origin main; then
    echo "[auto-review-loop] git fetch failed; continuing with current state"
  elif ! git reset --hard origin/main; then
    echo "[auto-review-loop] git reset --hard failed; continuing with current state"
  elif ! pnpm install --frozen-lockfile; then
    echo "[auto-review-loop] pnpm install --frozen-lockfile failed; skipping tsx start (counts as fast exit)"
    SETUP_OK=0
  fi

  if [ "$SETUP_OK" -eq 1 ]; then
    echo "[auto-review-loop] $(date '+%H:%M:%S') starting tsx poll.cli.ts (pid will follow)..."
    START_TS=$(date +%s)
    set +e
    pnpm exec tsx scripts/auto-review/poll.cli.ts
    EXIT=$?
    set -e
    UPTIME=$(($(date +%s) - START_TS))
  else
    EXIT=1
    UPTIME=0
  fi

  if [ "$STOP" -eq 1 ]; then
    echo "[auto-review-loop] stop flag set, exiting (last exit=$EXIT)"
    break
  fi

  if [ "$UPTIME" -lt "$FAST_EXIT_THRESHOLD_SEC" ]; then
    FAST_EXIT_COUNT=$((FAST_EXIT_COUNT + 1))
    echo "[auto-review-loop] fast exit detected (uptime=${UPTIME}s < ${FAST_EXIT_THRESHOLD_SEC}s, exit=$EXIT, count=${FAST_EXIT_COUNT}/${FAST_EXIT_MAX})"
    if [ "$FAST_EXIT_COUNT" -ge "$FAST_EXIT_MAX" ]; then
      echo "[auto-review-loop] ${FAST_EXIT_MAX} consecutive fast exits (last exit=$EXIT); bailing — investigate startup failure (env var / dep install / OAuth token / state.json)"
      exit 1
    fi
  else
    FAST_EXIT_COUNT=0
  fi

  if [ "$EXIT" -ne 0 ]; then
    echo "[auto-review-loop] poll.cli.ts exited non-zero ($EXIT), restarting in 2s..."
  else
    echo "[auto-review-loop] poll.cli.ts exited cleanly, restarting in 2s..."
  fi
  sleep 2
done
