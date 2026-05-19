#!/usr/bin/env bash
# Single source of truth for repo gates。pre-commit hook と CI workflow が共通参照する。
#
# 設計:
#   - `GATES_STAGED` / `GATES_FULL_ONLY` 配列が gate の **唯一の源泉**。
#     新規 gate 追加はここに 1 行 + `cmd_run` の case に handler 1 つ
#   - `gates.sh list <staged|full>` で名を 1 行 1 つ stdout → 呼び出し側 (hook / CI matrix) が consume
#       - staged: file-scoped で fast (`GATES_STAGED` のみ、pre-commit hook 用)
#       - full  : repo 全体評価 (`GATES_STAGED` + `GATES_FULL_ONLY`、CI 用)
#   - `gates.sh run <name> <staged|full> [files...]` で 1 つ実行
#
# 効果: 「pre-commit と CI で check が drift」が構造的に不可能になる (PR #41 で観測した
# 「format:check が hook に欠落して CI で初めて落ちた」事故の根絶)。
#
# staged / full の区分:
#   - staged: 1 file 単位で完結 → pre-commit 適合 (eslint / prettier / secret 等)
#   - full-only: repo 全体評価が必須 or 重い → pre-commit には乗せない (typecheck / build / coverage)
#     CI 側はすべて回るので、commit 時に catch されなくても push / PR で必ず弾かれる

set -euo pipefail

# staged mode (= pre-commit hook) と full mode (= CI) の両方で実行する gate。
# file-scoped で fast に動くもの。
GATES_STAGED=(
  secrets
  no-ignore
  line-count
  graph-tags
  css-tokens
  log-check
  covers-exist
  lint
  format-check
  coverage-staged
)

# CI でしか走らせない gate。repo 全体評価 or 実行時間が pre-commit には重い。
GATES_FULL_ONLY=(
  typecheck
  test-coverage
  build
)

cmd_list() {
  local mode=${1:-full}
  case "$mode" in
    staged)
      printf '%s\n' "${GATES_STAGED[@]}"
      ;;
    full)
      printf '%s\n' "${GATES_STAGED[@]}" "${GATES_FULL_ONLY[@]}"
      ;;
    *)
      echo "unknown list mode: $mode (expected staged|full)" >&2
      exit 1
      ;;
  esac
}

cmd_run() {
  local name=$1
  local mode=$2
  shift 2
  local files=("$@")

  case "$name" in
    secrets)
      if [ "$mode" = staged ]; then
        bash scripts/hooks/secret-check.sh "${files[@]}"
      else
        # shellcheck disable=SC2046
        bash scripts/hooks/secret-check.sh $(git ls-files)
      fi
      ;;
    no-ignore)
      if [ "$mode" = staged ]; then
        bash scripts/hooks/check-no-ignore.sh "${files[@]}"
      else
        # shellcheck disable=SC2046
        bash scripts/hooks/check-no-ignore.sh $(git ls-files)
      fi
      ;;
    line-count)
      if [ "$mode" = staged ]; then
        pnpm exec tsx scripts/hooks/check-line-count.cli.ts "${files[@]}"
      else
        # shellcheck disable=SC2046
        pnpm exec tsx scripts/hooks/check-line-count.cli.ts $(git ls-files)
      fi
      ;;
    graph-tags)
      if [ "$mode" = staged ]; then
        pnpm exec tsx scripts/hooks/check-graph-tags.cli.ts "${files[@]}"
      else
        # shellcheck disable=SC2046
        pnpm exec tsx scripts/hooks/check-graph-tags.cli.ts $(git ls-files)
      fi
      ;;
    css-tokens)
      # design-tokens dist (= 全 semantic / primitive token の SoT) を CLI が読むため、
      # 先に build:css を流して dist 不在による silent skip / 誤検出を防ぐ。pre-commit
      # は staged に `.css` が含まれる時しか本 case に入らないので、build の overhead
      # は十分小さい。CI 側でも `gate (css-tokens)` job は `needs: build` 無しで動く
      # ので本 case 内で build を踏むのが SSoT (= 「pre-commit と CI で check が drift」
      # の構造的排除)。
      pnpm --filter @self/design-tokens build:css >/dev/null
      if [ "$mode" = staged ]; then
        pnpm exec tsx scripts/hooks/check-css-tokens.cli.ts "${files[@]}"
      else
        # shellcheck disable=SC2046
        pnpm exec tsx scripts/hooks/check-css-tokens.cli.ts $(git ls-files '*.css')
      fi
      ;;
    log-check)
      # operations/log.md の compaction check (whole-repo state、staged/full 共通)
      pnpm exec tsx scripts/compact-log.cli.ts --check
      ;;
    covers-exist)
      # content/posts/*.{ja,en}.md 全てに対して public/posts/<slug>.<lang>.cover.png
      # が存在することを check (whole-repo state、staged/full 共通)。`generate-covers`
      # は手動運用なので、PNG 未生成 + cover frontmatter 未記入の post を merge する
      # と og:image / twitter:image / JSON-LD image が 404 を指す事故が起き得る。
      pnpm exec tsx scripts/check-covers-exist.cli.ts
      ;;
    lint)
      if [ "$mode" = staged ]; then
        local ts_files
        ts_files=$(printf '%s\n' "${files[@]}" | grep -E '\.(ts|tsx|js|jsx|mjs|cjs)$' || true)
        if [ -n "$ts_files" ]; then
          # shellcheck disable=SC2086
          pnpm exec eslint --max-warnings=0 --no-warn-ignored $ts_files
        fi
      else
        pnpm exec eslint . --max-warnings=0
      fi
      ;;
    format-check)
      if [ "$mode" = staged ]; then
        pnpm exec prettier --check --ignore-unknown "${files[@]}"
      else
        pnpm exec prettier --check .
      fi
      ;;
    coverage-staged)
      # staged source file 限定の per-file 90% coverage check (pre-commit 用)。
      # 各 staged source に対応 test file が存在するかを確認した上で、vitest を
      # `--related <files>` + `--coverage.include=<each>` で実行する。CI 側の
      # `test-coverage` (= 全 file 評価) より高速だが scope が staged 限定なので
      # 互換性は完全でない (= staged で触らなかった file の coverage 回帰は
      # CI 側で初めて落ちる)。CI と pre-commit で「coverage 対象集合」が drift
      # しないよう、両者は `scripts/hooks/coverage-config.ts` を SSoT として参照。
      #
      # full mode (= CI matrix) では既に `test-coverage` gate が repo 全体を踏むので、
      # 本 gate は staged のみ呼ぶ (full では noop)。
      if [ "$mode" = staged ]; then
        pnpm exec tsx scripts/hooks/check-staged-coverage.cli.ts "${files[@]}"
      fi
      ;;
    typecheck)
      # turbo task `typecheck` は `^build` に dependsOn しているため、`@self/content`
      # の dist 等 consumer の TS resolution に必要な artifact を先に build する。
      # gates.sh を pnpm script 経由で呼ぶことで CI matrix 並列 (build job と独立) でも
      # 単体で完結する。
      pnpm typecheck
      ;;
    test-coverage)
      # vitest config が vite plugin (rendered-posts) 経由で `@self/content` を esbuild
      # bundling 時に解決するため、dist が必要。root script 側で turbo build を prepend。
      pnpm test:coverage
      ;;
    build)
      pnpm build
      ;;
    *)
      echo "unknown gate: $name" >&2
      echo "available (staged): ${GATES_STAGED[*]}" >&2
      echo "available (full-only): ${GATES_FULL_ONLY[*]}" >&2
      exit 1
      ;;
  esac
}

case "${1:-}" in
  list)
    shift
    cmd_list "${1:-full}"
    ;;
  run)
    shift
    if [ "$#" -lt 2 ]; then
      echo "usage: $0 run <name> <staged|full> [files...]" >&2
      exit 1
    fi
    cmd_run "$@"
    ;;
  *)
    echo "usage: $0 list [staged|full] | run <name> <staged|full> [files...]" >&2
    exit 1
    ;;
esac
