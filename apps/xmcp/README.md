# apps/xmcp — X API MCP server (両アカウント対応)

X API の OpenAPI spec を FastMCP 経由で MCP tools として expose する。
self-management mono-repo に取り込み済み (旧 `~/Workspace/xmcp/` から移植)。

## 構成

- `server.py` — FastMCP 本体 (OpenAPI から tool 自動生成、OAuth1 で署名)
- `secret_loader.py` — GCP Secret Manager から OAuth credentials を fetch
- `requirements.txt` — Python 依存
- `env.example` — local dev 用 .env テンプレ
- `launchd/com.user.xmcp-{en,jp}.plist` — 各アカウント用 launchd plist
- `test_grok_mcp.py` — Grok 経由の手動テストクライアント

## 両アカウント運用

`X_ACCOUNT` env で account を切替えて 2 プロセス常駐。

| Account          | Handle           | Port | launchd label    |
| ---------------- | ---------------- | ---- | ---------------- |
| ryantsuji        | @ryantsuji       | 8765 | com.user.xmcp-en |
| ryanaircloset    | @RyanAircloset   | 8766 | com.user.xmcp-jp |

X dev app の consumer key/secret + bearer token は両アカウントで **共通**、
user-level OAuth1 access_token / access_token_secret のみアカウント別。

## Secret Manager 構成

Pulumi (`infra/core/index.ts`) が以下を declarative 管理:

| Secret name                 | 内容 (JSON keys)                                                         |
| --------------------------- | ------------------------------------------------------------------------ |
| `xmcp-app-credentials`      | `X_OAUTH_CONSUMER_KEY` / `X_OAUTH_CONSUMER_SECRET` / `X_BEARER_TOKEN`    |
| `xmcp-user-ryantsuji`       | `X_OAUTH_ACCESS_TOKEN` / `X_OAUTH_ACCESS_TOKEN_SECRET`                   |
| `xmcp-user-ryanaircloset`   | `X_OAUTH_ACCESS_TOKEN` / `X_OAUTH_ACCESS_TOKEN_SECRET`                   |

Secret 値は OAuth1 flow で取得 → Ryan が手動で `gcloud secrets versions add` で投入。
Pulumi は container と IAM (graph-app SA に secretAccessor) のみ管理。

## 初回 setup

```bash
cd apps/xmcp
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## OAuth1 token の取得 (アカウント追加時の 1 回限り)

`get_user_token.py` で OAuth1 flow → handle 確認 → JSON 出力 → Secret Manager 投入を 1 行で:

```bash
cd apps/xmcp
source .venv/bin/activate

# 事前: 対象 X account (例: @RyanAircloset) で X にログイン済みにしておく
# (default browser のセッションが authorize 対象に使われる)

python get_user_token.py ryanaircloset \
  | gcloud secrets versions add xmcp-user-ryanaircloset \
    --project=ryan-self-management --data-file=-
```

`get_user_token.py` は:
1. `xmcp-app-credentials` から consumer key/secret を fetch
2. OAuth1 flow を起動 (default browser opens)
3. 取得した token で `/2/users/me` を叩いて handle 確認 (期待値と違えば warn)
4. stdout に `{X_OAUTH_ACCESS_TOKEN, X_OAUTH_ACCESS_TOKEN_SECRET}` の JSON を吐く

stderr に進捗メッセージ、stdout は JSON のみなので `gcloud ... --data-file=-` に直 pipe 可。

## launchd 起動

```bash
# 両プロセス load
launchctl bootstrap gui/$(id -u) apps/xmcp/launchd/com.user.xmcp-en.plist
launchctl bootstrap gui/$(id -u) apps/xmcp/launchd/com.user.xmcp-jp.plist

# 状態確認
launchctl list | grep xmcp

# log
tail -f ~/Library/Logs/xmcp-en.log
tail -f ~/Library/Logs/xmcp-jp.log

# 停止
launchctl bootout gui/$(id -u) apps/xmcp/launchd/com.user.xmcp-en.plist
```

## .mcp.json

```json
"xmcp-en": {
  "type": "http",
  "url": "http://127.0.0.1:8765/mcp",
  "_comment": "@ryantsuji (English)"
},
"xmcp-jp": {
  "type": "http",
  "url": "http://127.0.0.1:8766/mcp",
  "_comment": "@RyanAircloset (Japanese)"
}
```
