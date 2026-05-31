# GitHub App セットアップ — workflow 用 token を user PAT から分離する

## 背景

content repo (`thujikun/ryantsuji-dev-content`) と monorepo (`thujikun/self-management`) を跨ぐ workflow が user PAT (`MONOREPO_DISPATCH_PAT` / `BOT_PAT`) を使っていて、これは user の API quota (5000/hr) を消費する。同じ user が gh CLI で操作している間に枯渇すると workflow が HTTP 403 で落ちる。

GitHub App の installation token は **installation 単位で独立した 5000/hr quota** を持つので、user 操作の影響を受けない。

## App 作成手順

### 1. GitHub App を作る

1. <https://github.com/settings/apps/new> を開く
2. 各項目を以下で埋める:
   - **GitHub App name**: `ryantsuji-content-bot` (任意・unique であれば何でも)
   - **Homepage URL**: `https://github.com/thujikun/self-management` (任意)
   - **Webhook**: **Active のチェックを外す** (Webhook は使わない)
   - **Repository permissions**:
     - Contents: **Read and write**
     - Pull requests: **Read and write**
     - Actions: **Read and write** (repository_dispatch 用)
     - Metadata: **Read-only** (default、必須)
     - Workflows: **Read and write** (workflow file の更新 PR が出る場合のため)
     - Issues: **Read and write** (PR にラベル付けする `gh label create` で必要)
   - **Where can this GitHub App be installed?**: **Only on this account**
3. 「Create GitHub App」

### 2. Private key を生成

App 作成直後の画面で:

1. 「Private keys」セクション → 「Generate a private key」
2. `.pem` ファイルがダウンロードされるので、内容をコピー（後で secret に貼る）

### 3. App を両 repo に install

1. App の General ページで **App ID** を控える (上部に表示されている数字)
2. 左サイドバーの「Install App」をクリック
3. 自分のアカウント横の「Install」を押す
4. **Only select repositories** を選び、以下 2 つを指定:
   - `thujikun/ryantsuji-dev-content`
   - `thujikun/self-management`
5. 「Install」

### 4. Secret を両 repo に登録

両 repo それぞれの Settings → Secrets and variables → Actions → New repository secret で以下を作る:

| Secret 名 | 値 |
|---|---|
| `APP_ID` | 手順 3 で控えた App ID (数字) |
| `APP_PRIVATE_KEY` | `.pem` ファイルの中身全文（`BEGIN RSA PRIVATE KEY` のヘッダー行から `END RSA PRIVATE KEY` のフッター行まで） |

両 repo (`ryantsuji-dev-content` と `self-management`) に同じ値で 2 セットずつ登録。

### 5. Workflow を切り替える

workflow patch は別 PR で適用済み（このドキュメントとセット）。

旧 secret (`MONOREPO_DISPATCH_PAT` / `BOT_PAT`) は新 workflow が安定したら削除して OK。

## 確認方法

### `dispatch-on-push.yml` (content repo)

1. content repo の Actions タブで「Dispatch parent on content push」を `workflow_dispatch` で手動実行
2. self-management 側の「Bump content submodule」が新規 run として起動すれば成功

### `bump-submodule.yml` (self-management)

1. 上の dispatch を経由して PR が開けば成功
2. PR の CI が green → auto-merge も成功すれば完成

### Rate limit

```bash
GH_TOKEN=$INSTALLATION_TOKEN gh api rate_limit --jq '.resources.core'
```

`limit: 5000` が user quota とは別枠で動いていることを確認できる。
