"""指定 X account の OAuth1 user token を取得する 1 回限りのヘルパー。

使い方:

    cd apps/xmcp
    source .venv/bin/activate
    python get_user_token.py ryanaircloset \\
      | gcloud secrets versions add xmcp-user-ryanaircloset \\
        --project=ryan-self-management --data-file=-

挙動:
1. xmcp-app-credentials secret から consumer key/secret を fetch
2. OAuth1 flow (browser 開いて authorize、127.0.0.1:8976 で callback 受信)
3. 取得した token で `getUsersMe` を叩き、authorize された user の handle を表示
4. stdout に `xmcp-user-{account}` 用の JSON を出力 (`gcloud secrets versions add` に直接 pipe 可)

注意: browser は default browser を開く。事前に対象アカウントで X にログインしておくか、
private window で対象アカウントにログインした状態で実行する。
"""
import argparse
import json
import os
import sys

import requests
from requests_oauthlib import OAuth1


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("account", help="期待される handle (確認用、e.g. 'ryanaircloset')")
    parser.add_argument(
        "--project",
        default=os.environ.get("GOOGLE_CLOUD_PROJECT", "ryan-self-management"),
        help="GCP project (default: GOOGLE_CLOUD_PROJECT env or ryan-self-management)",
    )
    args = parser.parse_args()

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

    # 1. consumer creds を Secret Manager から fetch
    from google.cloud import secretmanager

    client = secretmanager.SecretManagerServiceClient()
    name = f"projects/{args.project}/secrets/xmcp-app-credentials/versions/latest"
    response = client.access_secret_version(request={"name": name})
    app_creds = json.loads(response.payload.data.decode("utf-8"))
    for k, v in app_creds.items():
        os.environ.setdefault(k, v)

    # 2. OAuth1 flow を起動 (server.py の helper を再利用)
    from server import run_oauth1_flow

    print(f"[*] OAuth1 flow を開始。browser が開いたら @{args.account} で authorize してください...", file=sys.stderr)
    access_token, access_secret = run_oauth1_flow()

    # 3. 取得した token で /2/users/me を叩いて確認
    consumer_key = os.environ["X_OAUTH_CONSUMER_KEY"]
    consumer_secret = os.environ["X_OAUTH_CONSUMER_SECRET"]
    auth = OAuth1(consumer_key, consumer_secret, access_token, access_secret)
    me = requests.get("https://api.x.com/2/users/me", auth=auth, timeout=15).json()
    handle = me.get("data", {}).get("username", "<unknown>")
    print(f"[*] authorize された account: @{handle}", file=sys.stderr)
    if handle.lower() != args.account.lower():
        print(
            f"[!] WARNING: 期待 @{args.account} と異なる。意図したアカウントで再試行を推奨。",
            file=sys.stderr,
        )

    # 4. stdout に JSON を吐く (gcloud secrets versions add に pipe する想定)
    payload = {
        "X_OAUTH_ACCESS_TOKEN": access_token,
        "X_OAUTH_ACCESS_TOKEN_SECRET": access_secret,
    }
    print(json.dumps(payload))


if __name__ == "__main__":
    main()
