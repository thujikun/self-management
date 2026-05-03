# infra/core

self-management の core インフラ。

## 中身

- BigQuery dataset `ryan` (location: `asia-northeast1`)
- Service account `graph-app@ryan-self-management.iam.gserviceaccount.com`
- IAM:
  - `graph-app` SA に `roles/bigquery.dataEditor` on `ryan` dataset
  - `graph-app` SA に `roles/bigquery.jobUser` on project
- SA key (Pulumi state で暗号化保管)

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
