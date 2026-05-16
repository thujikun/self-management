#!/usr/bin/env bash
#
# auto-review process supervisor。
#
# - 各起動前に `git fetch origin main` + `git reset --hard origin/main` で local clone を最新化
#   (self-management-review は観察者 clone 前提。local 変更があれば消える、それが intended)
# - tsx poll.cli.ts を実行
# - poll.cli.ts が exit 0 で抜けたら ~2 秒 sleep して再起動 (= 「30 分 + idle」での self-restart 経路)
# - poll.cli.ts が非 0 で抜けたら同様だが warn を出す (debug 用)
# - SIGINT / SIGTERM (Ryan の CTRL+C 含む) は trap で吸って exit、再起動しない
#
# 想定 cwd: self-management(-review) repo root
#
# Node の import は再読込されないので、新 main を反映するには process を作り直す必要がある。
# このループで「30 分 + idle → poll が自発的に exit → loop が fresh git + fresh node で起動」を実現

set -uo pipefail

STOP=0
trap 'STOP=1; echo "[auto-review-loop] received signal, stopping after current iteration"; exit 130' SIGINT SIGTERM

while [ "$STOP" -eq 0 ]; do
  echo "[auto-review-loop] $(date '+%H:%M:%S') sync to origin/main..."
  if ! git fetch origin main; then
    echo "[auto-review-loop] git fetch failed; continuing with current state"
  elif ! git reset --hard origin/main; then
    echo "[auto-review-loop] git reset --hard failed; continuing"
  fi

  echo "[auto-review-loop] $(date '+%H:%M:%S') starting tsx poll.cli.ts (pid will follow)..."
  set +e
  pnpm exec tsx scripts/auto-review/poll.cli.ts
  EXIT=$?
  set -e

  if [ "$STOP" -eq 1 ]; then
    echo "[auto-review-loop] stop flag set, exiting (last exit=$EXIT)"
    break
  fi

  if [ "$EXIT" -ne 0 ]; then
    echo "[auto-review-loop] poll.cli.ts exited non-zero ($EXIT), restarting in 2s..."
  else
    echo "[auto-review-loop] poll.cli.ts exited cleanly, restarting in 2s..."
  fi
  sleep 2
done
