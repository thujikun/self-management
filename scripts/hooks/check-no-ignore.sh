#!/bin/bash
# Lint / type-check 抑制コメントの混入を検出 (絶対禁止)。
#
# Ryan ルール: 「eslint-disable は絶対禁止」(2026-05-05)。同じ理由で `@ts-ignore` /
# `@ts-nocheck` / `@ts-expect-error` も禁止 (型エラーは構造で解く、抑制で逃げない)。
# `// prettier-ignore` も禁止 (フォーマットはツールに任せる、ad-hoc 例外なし)。
#
# 例外: README / docs 内で「禁止コメント」を**説明する**目的の記述は許容。
# その場合は markdown ファイル内のみ。
#
# 引数: changed file path のリスト (空なら exit 0)。

set -e
FILES="$@"
if [ -z "$FILES" ]; then exit 0; fi

PATTERNS=(
  "eslint-disable"
  "@ts-ignore"
  "@ts-nocheck"
  "@ts-expect-error"
  "prettier-ignore"
  "biome-ignore"
)

FAILED=0
for file in $FILES; do
  [ -f "$file" ] || continue
  # markdown は説明目的での記述を許容
  case "$file" in
    *.md) continue ;;
    # 本 guard 自身と eslint config は禁止コメント名を文字列として扱うため除外
    scripts/hooks/check-no-ignore.sh) continue ;;
    eslint.config.js) continue ;;
  esac
  for p in "${PATTERNS[@]}"; do
    if grep -nE "$p" "$file" > /dev/null 2>&1; then
      echo "❌ $file: forbidden suppression comment '$p'"
      grep -nE "$p" "$file" | sed 's/^/    /'
      FAILED=1
    fi
  done
done

if [ "$FAILED" -eq 1 ]; then
  echo
  echo "禁止コメント (eslint-disable / @ts-* / prettier-ignore 等) は使えません。"
  echo "型エラー / lint エラーは抑制ではなく構造で解決してください。"
  exit 1
fi
