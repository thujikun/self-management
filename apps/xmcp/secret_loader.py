"""GCP Secret Manager から xmcp の OAuth credentials を読み出して os.environ に注入する。

Secret 構成:
- `xmcp-app-credentials`: X dev app の credentials (両アカウント共通)
    JSON keys: X_OAUTH_CONSUMER_KEY / X_OAUTH_CONSUMER_SECRET / X_BEARER_TOKEN
                (任意: X_CLIENT_ID / X_CLIENT_SECRET — OAuth2 user token 生成用)
- `xmcp-user-{account}`: 各 X user account の OAuth1 user token
    JSON keys: X_OAUTH_ACCESS_TOKEN / X_OAUTH_ACCESS_TOKEN_SECRET

Secret 内容は OAuth1 flow で取得した値を Ryan が手動で `gcloud secrets versions add` で
投入する。Pulumi は container と IAM のみ管理。

`account` は `X_ACCOUNT` env で指定 (e.g. "ryantsuji" / "ryanaircloset")。

graph-app SA は infra/core/index.ts で各 secret に secretAccessor が bind 済み。
"""
import json
import logging
import os

LOGGER = logging.getLogger("xmcp.secrets")


def load_secrets_from_gcp(project_id: str, account: str) -> None:
    """指定 account の OAuth credentials を Secret Manager から fetch して os.environ に書く。

    Secret Manager を **authoritative** とする (既存 env を上書きする)。理由は launchd plist が
    `/bin/zsh -i` 経由で `.zshrc` の `export X_OAUTH_*` を継承する場合、特定アカウントの古い
    credentials が env に居座って per-account 切替を破壊するため (per-account 切替こそが
    Secret Manager 化の主目的)。
    """
    if not project_id:
        raise RuntimeError("project_id required for Secret Manager loader")
    if not account:
        raise RuntimeError("account required for Secret Manager loader")

    # google-cloud-secret-manager は重い import なのでここで遅延 import
    from google.cloud import secretmanager

    client = secretmanager.SecretManagerServiceClient()
    app_creds = _fetch_secret_json(client, project_id, "xmcp-app-credentials")
    user_creds = _fetch_secret_json(client, project_id, f"xmcp-user-{account}")

    for key, value in {**app_creds, **user_creds}.items():
        os.environ[key] = value

    LOGGER.info(
        "Loaded credentials from Secret Manager (account=%s, app_keys=%d, user_keys=%d)",
        account,
        len(app_creds),
        len(user_creds),
    )


def _fetch_secret_json(client, project_id: str, secret_name: str) -> dict:
    """`projects/{project}/secrets/{name}/versions/latest` を fetch して JSON parse。"""
    name = f"projects/{project_id}/secrets/{secret_name}/versions/latest"
    response = client.access_secret_version(request={"name": name})
    payload = response.payload.data.decode("utf-8")
    parsed = json.loads(payload)
    if not isinstance(parsed, dict):
        raise RuntimeError(f"Secret {secret_name} payload is not a JSON object")
    return parsed
