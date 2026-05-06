"""指定 X account の OAuth 2.0 user-context tokens を PKCE flow で取得する 1 回限りのヘルパー。

OAuth1 (`get_user_token.py`) では bookmark endpoint 等が 403 になるため、OAuth2 user
context が必要な機能用に別 token を取得する。

使い方:

    cd apps/xmcp
    source .venv/bin/activate
    python get_oauth2_token.py ryanaircloset \\
      | gcloud secrets versions add xmcp-user-ryanaircloset-oauth2 \\
        --project=ryan-self-management --data-file=-

挙動:
1. xmcp-app-credentials secret から X_CLIENT_ID / X_CLIENT_SECRET を fetch
2. PKCE flow (S256) を実行: code_verifier 生成 → browser で authorize → callback で code 受信
3. /2/oauth2/token で code → access_token + refresh_token を交換
4. /2/users/me で handle 確認 (期待値と違えば warn)
5. stdout に `{X_OAUTH2_ACCESS_TOKEN, X_OAUTH2_REFRESH_TOKEN, X_OAUTH2_EXPIRES_AT}` JSON 出力

scope は tweet.read / users.read / bookmark.read / offline.access (refresh 用) を要求。
"""
import argparse
import base64
import hashlib
import http.server
import json
import os
import secrets
import socketserver
import sys
import threading
import time
import urllib.parse
import webbrowser

import requests

AUTHORIZE_URL = "https://x.com/i/oauth2/authorize"
TOKEN_URL = "https://api.x.com/2/oauth2/token"
USERS_ME_URL = "https://api.x.com/2/users/me"

CALLBACK_HOST = "127.0.0.1"
CALLBACK_PORT = 8976
CALLBACK_PATH = "/oauth/callback"
CALLBACK_TIMEOUT = 300

SCOPES = ["tweet.read", "users.read", "bookmark.read", "offline.access"]


def _pkce_pair() -> tuple[str, str]:
    """code_verifier と S256 code_challenge を生成。"""
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode("ascii")
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


def _wait_for_code(state: str) -> str:
    """browser callback に来た code を返す。state mismatch / timeout で RuntimeError。"""
    captured: dict[str, str | None] = {"code": None, "state": None}
    event = threading.Event()

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            parsed = urllib.parse.urlparse(self.path)
            if parsed.path != CALLBACK_PATH:
                self.send_response(404)
                self.end_headers()
                return
            q = urllib.parse.parse_qs(parsed.query)
            captured["code"] = (q.get("code") or [None])[0]
            captured["state"] = (q.get("state") or [None])[0]
            event.set()
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"OAuth2 complete. You may close this tab.")

        def log_message(self, format: str, *args: object) -> None:  # noqa: A003
            pass

    class _Server(socketserver.TCPServer):
        allow_reuse_address = True

    server = _Server((CALLBACK_HOST, CALLBACK_PORT), Handler)
    server.timeout = 1
    deadline = time.time() + CALLBACK_TIMEOUT
    try:
        while time.time() < deadline:
            server.handle_request()
            if event.is_set():
                break
    finally:
        server.server_close()

    if not captured["code"]:
        raise RuntimeError("OAuth2 callback timeout: no code received")
    if captured["state"] != state:
        raise RuntimeError(f"OAuth2 state mismatch: expected {state}, got {captured['state']}")
    return captured["code"]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("account", help="期待される handle (確認用、e.g. 'ryanaircloset')")
    parser.add_argument(
        "--project",
        default=os.environ.get("GOOGLE_CLOUD_PROJECT", "ryan-self-management"),
    )
    args = parser.parse_args()

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from google.cloud import secretmanager

    client = secretmanager.SecretManagerServiceClient()
    name = f"projects/{args.project}/secrets/xmcp-app-credentials/versions/latest"
    app = json.loads(client.access_secret_version(request={"name": name}).payload.data.decode("utf-8"))
    client_id = app.get("X_CLIENT_ID")
    client_secret = app.get("X_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise RuntimeError("xmcp-app-credentials に X_CLIENT_ID / X_CLIENT_SECRET が無い")

    redirect_uri = f"http://{CALLBACK_HOST}:{CALLBACK_PORT}{CALLBACK_PATH}"
    verifier, challenge = _pkce_pair()
    state = secrets.token_urlsafe(16)

    auth_params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": " ".join(SCOPES),
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    authorize_url = f"{AUTHORIZE_URL}?{urllib.parse.urlencode(auth_params)}"
    print(f"[*] OAuth2 PKCE flow を開始。browser が開いたら @{args.account} で authorize してください...", file=sys.stderr)
    webbrowser.open(authorize_url)

    code = _wait_for_code(state)
    print("[*] code 受信、token に交換中...", file=sys.stderr)

    token_resp = requests.post(
        TOKEN_URL,
        auth=(client_id, client_secret),  # confidential client なら Basic
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "code_verifier": verifier,
        },
        timeout=15,
    )
    if not token_resp.ok:
        raise RuntimeError(f"token exchange failed: {token_resp.status_code} {token_resp.text[:500]}")
    token_data = token_resp.json()
    access_token = token_data["access_token"]
    refresh_token = token_data.get("refresh_token", "")
    expires_in = int(token_data.get("expires_in", 7200))
    expires_at = int(time.time()) + expires_in

    me_resp = requests.get(
        USERS_ME_URL,
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=15,
    )
    handle = me_resp.json().get("data", {}).get("username", "<unknown>") if me_resp.ok else "<unknown>"
    print(f"[*] authorize された account: @{handle}", file=sys.stderr)
    if handle.lower() != args.account.lower():
        print(
            f"[!] WARNING: 期待 @{args.account} と異なる。意図したアカウントで再試行を推奨。",
            file=sys.stderr,
        )

    payload = {
        "X_OAUTH2_ACCESS_TOKEN": access_token,
        "X_OAUTH2_REFRESH_TOKEN": refresh_token,
        "X_OAUTH2_EXPIRES_AT": expires_at,
    }
    print(json.dumps(payload))


if __name__ == "__main__":
    main()
