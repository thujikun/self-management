# infra/core

self-management の core インフラ。

## 中身

- BigQuery dataset `ryan` (location: `asia-northeast1`)
- Service account `graph-app@ryan-self-management.iam.gserviceaccount.com`
- IAM:
  - `graph-app` SA に `roles/bigquery.dataEditor` on `ryan` dataset
  - `graph-app` SA に `roles/bigquery.jobUser` on project
  - `graph-app` SA に `roles/secretmanager.secretAccessor` on 各 Secret container
  - admin role 群 (`serviceUsageAdmin` / `projectIamAdmin` / `iam.serviceAccountAdmin` / `iam.serviceAccountKeyAdmin` / `compute.networkViewer` / `secretmanager.admin`)
- SA key (Pulumi state で暗号化保管)
- **Secret Manager containers** — Pulumi は container + IAM のみ管理、値は手動投入:
  - `grafana-cloud-admin-token` — Grafana Cloud Access Policy admin token (Pulumi が読み込んで OTLP write token を派生生成)
  - `grafana-otlp-write-token` — OTLP write 専用 token (Pulumi が grafana provider 経由で declarative 作成)
  - `grafana-mcp-token` — Grafana Stack-scoped Service Account Token (mcp-grafana 用)
  - `neon-database-url` — Neon Postgres connection string (`DATABASE_URL`)
  - `xmcp-app-credentials` — X dev app の consumer key/secret + bearer token
  - `xmcp-user-{ryantsuji,ryanaircloset}` — X user account の OAuth1 access token
- Cloud Run job `graph-migrate` + Artifact Registry repo `self-mgmt` (graph migrate ジョブ用)
- Grafana Cloud Stack 連携 (OTLP endpoint + write token を declarative 管理)

## Secret 値の投入 (初回 / 更新時)

Pulumi は container と IAM のみを管理し、値は Ryan が手動で投入する運用 (token は infra ではなく credential なので state に乗せない)。

```bash
# Neon DATABASE_URL
echo -n "postgresql://neondb_owner:...@...neon.tech/neondb?sslmode=require" | \
  gcloud secrets versions add neon-database-url \
    --data-file=- --project=ryan-self-management

# Grafana MCP token (Stack UI で SA + token を作成 → 投入)
gcloud secrets versions add grafana-mcp-token \
  --data-file=- --project=ryan-self-management <<< "$GRAFANA_SAT_TOKEN"

# 投入確認
gcloud secrets versions list neon-database-url --project=ryan-self-management
```

`grafana-otlp-write-token` だけは Pulumi が grafana provider 経由で declarative に作成・投入するので手動操作不要。

## 値の消費経路

- **dev (`.envrc`)**: `gcloud secrets versions access latest --secret=<name>` で env var に展開
- **production (CF Workers)**: `wrangler secret put <NAME>` で binding に投入 (deploy 直前に GCP から手で読んで wrangler に流す)
- **graph-app SA からの read**: SA は `secretmanager.secretAccessor` を持つので、Cloud Run / Cloud Build / 各種 SDK から直接 `gcloud secrets versions access` できる

## 初回 setup

```bash
# 1. 個人 gcloud config に切替されていることを確認
direnv allow
gcloud config configurations list  # ryan-personal が ACTIVE

# 2. 個人アカウントで auth (1回だけ)
gcloud auth login
gcloud auth application-default login

# 3. APIs を有効化 (Pulumi 実行前に1回)
gcloud services enable \
  bigquery.googleapis.com \
  iam.googleapis.com \
  cloudresourcemanager.googleapis.com \
  --project=ryan-self-management

# 4. Pulumi backend (個人 use なので local file backend)
pulumi login --local

# 5. stack 作成
cd infra/core
pnpm install
pulumi stack init ryan
pulumi config set gcp:project ryan-self-management
pulumi config set gcp:region asia-northeast1

# 6. provision
pulumi up
```

## SA key を取り出す

```bash
# Pulumi output から JSON key を取り出して .config に保存
pulumi stack output --show-secrets graphServiceAccountKey | base64 -d > ../../.config/gcp-sa.json
chmod 600 ../../.config/gcp-sa.json
```

## destroy (やり直す場合)

```bash
pulumi destroy
```

注: `pulumi destroy` は dataset 内の table を含めて全削除する。データがあるときは慎重に。
