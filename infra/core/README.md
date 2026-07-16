# infra/core

self-management の core インフラ。

## 中身

- BigQuery dataset `ryan` (location: `asia-northeast1`)
  - Table `ryan.web_events` — ryantsuji.dev の client beacon (page view / engagement) を Worker `/api/track` (PR-B) 経由で streaming insert する analytics 表。`event_type` / `slug` で clustering、server-time `ingested_at` で daily partition (client skew 影響回避)、`expirationMs` 未設定 (個人スケールでは BQ free tier に十分収まる前提)
- Service account `graph-app@ryan-self-management.iam.gserviceaccount.com`
- IAM:
  - `graph-app` SA に `roles/bigquery.dataEditor` on `ryan` dataset
  - `graph-app` SA に `roles/bigquery.jobUser` on project
  - `graph-app` SA に `roles/secretmanager.secretAccessor` on 各 Secret container
  - admin role 群 (`serviceUsageAdmin` / `projectIamAdmin` / `iam.serviceAccountAdmin` / `iam.serviceAccountKeyAdmin` / `compute.networkViewer` / `secretmanager.admin`)
- SA key (Pulumi state で暗号化保管)
- **Secret Manager containers** — 基本は Pulumi が container + IAM のみ管理し、値は手動投入。一部 secret (`grafana-otlp-write-token` / `grafana-faro-collector-url`) は値も Pulumi が declarative に投入する (各行の "投入経路" を参照):
  - `grafana-cloud-admin-token` — Grafana Cloud Access Policy admin token (Pulumi が読み込んで OTLP write token / Faro App を派生生成)。投入経路: **手動 (`gcloud secrets versions add`)**。**policy 作成時の region と scope 要件は [`docs/infra/grafana-cloud-setup.md`](../../docs/infra/grafana-cloud-setup.md) 参照** (誤ると FO App provisioning が `request not authorized for stack` で落ちる)
  - `grafana-otlp-write-token` — OTLP write 専用 token。投入経路: **Pulumi declarative** (grafana provider 経由で発行 → SecretVersion で書き込み)
  - `grafana-mcp-token` — Grafana Stack-scoped Service Account Token (mcp-grafana 用)。投入経路: **手動**
  - `neon-database-url` — Neon Postgres connection string (`DATABASE_URL`)。投入経路: **手動**
  - `xmcp-app-credentials` — X dev app の consumer key/secret + bearer token。投入経路: **手動**
  - `xmcp-user-{ryantsuji,ryanaircloset}` — X user account の OAuth1 access token。投入経路: **手動**
  - `cloudflare-api-token` — CF Workers deploy 用 API token (`CLOUDFLARE_API_TOKEN`)。Ryan が CF Dashboard で Workers Scripts:Edit + Workers Routes:Edit (ryantsuji.dev) の minimal scope token を発行。投入経路: **手動**
  - `grafana-faro-collector-url` — Grafana Cloud Frontend Observability (Faro) collector URL。`infra/core/grafana-faro.ts` で Stack Admin SA + Token + 2nd `grafana.Provider` + `frontendobservability.App` を発行し、その `collectorEndpoint` output を `SecretVersion` として本 container に declarative 投入 (手動 UI 操作不要)。PR-B の ryantsuji.dev web build-time に inline で消費。投入経路: **Pulumi declarative**
- Cloud Run job `graph-migrate` + Artifact Registry repo `self-mgmt` (graph migrate ジョブ用)
- Grafana Cloud Stack 連携 (OTLP endpoint + write token を declarative 管理)
- **GitHub Actions WIF** — pool `github-actions` + provider `github-actions` + SA `pulumi-ci` (long-lived key 不使用)。本 repo (thujikun/self-management) からの workflow のみ impersonate 可

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

`grafana-otlp-write-token` と `grafana-faro-collector-url` は Pulumi が declarative に作成・投入するので手動操作不要 (前者は Cloud-level Access Policy Token 経由、後者は `infra/core/grafana-faro.ts` で Stack Admin SA + 2nd `grafana.Provider` + `frontendobservability.App` 経由)。`grafana-cloud-admin-token` の policy 設計詳細 (region / scope) は [`docs/infra/grafana-cloud-setup.md`](../../docs/infra/grafana-cloud-setup.md) を参照。

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

## GitHub Actions Pulumi workflow

`.github/workflows/pulumi.yml` が `infra/**` 変更 PR で **preview + comment**、main merge で **`pulumi up --yes`** を auto-apply する。auth は WIF (GitHub OIDC → `pulumi-ci@` SA、long-lived key 不使用)。

### 必要な GitHub secrets / variables

repo settings → Secrets and variables → Actions:

**Secrets**:
- `PULUMI_ACCESS_TOKEN` — Pulumi Cloud personal access token (`app.pulumi.com/account/tokens` で発行)

Pulumi state encryption は Cloud KMS で完結するため `PULUMI_CONFIG_PASSPHRASE` は不要 (passphrase-encrypted な `secure:` config を残さない方針)。Cloudflare provider token は WIF 経由で `cloudflare-api-token` secret から workflow が動的取得する (yaml に直書きしない)。

**Variables** (secret じゃない、値は公開しても害なし):
- `GCP_PROJECT_ID` = `ryan-self-management`
- `GCP_PROJECT_NUMBER` = `600456222971` (`gcloud projects describe ryan-self-management --format="value(projectNumber)"`)
- `PULUMI_CI_SA_EMAIL` = `pulumi-ci@ryan-self-management.iam.gserviceaccount.com`
- `DEVTO_IMPORT_SA_EMAIL` = `devto-import@ryan-self-management.iam.gserviceaccount.com`
  (import-devto-comments.yml 専用の最小権限 SA。権限は `neon-database-url` の
  `secretAccessor` のみ。本 stack の `devto-import-sa` を apply してから設定する)
- `PULUMI_ORG` = `tsuji-0107-gmail-com` (Pulumi Cloud organization slug)

### bootstrap (初回のみ、手で 1 回 `pulumi up` を local から)

WIF pool / provider / pulumi-ci SA は本 stack で declarative 管理されているが、stack 自体を初回 apply する時はまだ pool が存在しないので、**ローカル credential** で 1 回 up を回す必要がある。2 回目以降は CI が WIF で自走する。

```bash
cd infra/core
direnv allow
pnpm exec pulumi up    # local backend → cloud backend どちらでも OK
```

これで pool / provider / SA が作成された後、上記の secrets / vars を GitHub に投入すれば CI で動く。
