#!/bin/zsh
# 17 MCP Servers thread を chain post する一発スクリプト
# launchd / cron / 手動実行いずれも可

set -euo pipefail

SCRIPT_DIR="${0:A:h}"
WORKSPACE_DIR="${SCRIPT_DIR:h}"

# automation env を読み込み (XMCP_AUTOMATION_SESSION 等)
source "$WORKSPACE_DIR/config/automation.env"

LOG_FILE="$XMCP_LOG_DIR/xmcp-thread.log"
mkdir -p "$XMCP_LOG_DIR"

# claude -p に渡す指示
read -r -d '' PROMPT <<'EOF' || true
今すぐ 17 MCP Servers thread を投稿してください。手順は /Users/ryan/Workspace/self-management/playbooks/post-thread.md に従う。

具体的に:
1. /Users/ryan/Workspace/self-management/threads/17-mcp-servers.md を読み、Tweet 1〜5 の本文を抽出 (markdown コードブロック内)
2. mcp__xmcp__createPosts で Tweet 1 を投稿 → id を保存
3. Tweet 2-5 を **直前の tweet** に reply する形で chain 投稿 (root への reply は厳禁、branch になる)
4. mcp__xmcp__getPostsById で全 5本の referenced_tweets を確認、正しい chain になっていることを検証
5. /Users/ryan/Workspace/self-management/threads/posted/2026-05-03-17mcp.md に結果を YAML frontmatter 付きで保存
6. /Users/ryan/Workspace/self-management/operations/log.md の末尾 (今夜 JST 20:00 予定 entry の続き) に成功 entry を追記
7. 失敗時はそこで中断、エラーをログに残す

Tweet 2/3 は圧縮版を使用 (threads/17-mcp-servers.md に既に反映済み)。元の long-form ではないので 280字に収まる。
EOF

{
  echo "================================================================"
  echo "=== START: $(date '+%Y-%m-%d %H:%M:%S %Z')"
  echo "================================================================"

  cd "$WORKSPACE_DIR"

  # claude -p で投稿実行
  # --resume はあえて使わない (現セッションと衝突する、また disk-driven の方が context-full 耐性が高い)
  # context は prompt + playbook + memory + disk markdown から再構築させる
  # --permission-mode bypassPermissions: auto 実行のため MCP tool の確認をスキップ
  /opt/homebrew/bin/claude -p "$PROMPT" \
    --permission-mode bypassPermissions

  EXIT_CODE=$?
  echo "================================================================"
  echo "=== END: $(date '+%Y-%m-%d %H:%M:%S %Z') (exit: $EXIT_CODE)"
  echo "================================================================"

  # 投稿成功 (exit 0) かつ launchd plist が active なら自動 disable
  if [[ $EXIT_CODE -eq 0 ]] && launchctl print "gui/$(id -u)/com.user.xmcp-post-17mcp" &>/dev/null; then
    echo "Disabling one-shot launchd job..."
    launchctl bootout "gui/$(id -u)/com.user.xmcp-post-17mcp" || true
  fi

} >> "$LOG_FILE" 2>&1
