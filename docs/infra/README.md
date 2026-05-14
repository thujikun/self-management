# Infrastructure

self-management のインフラ構成 (Pulumi)。個人 GCP プロジェクト `ryan-self-management` (region: `asia-northeast1`) で運用。

## stacks

| stack | 役割 | 依存 |
|-------|------|------|
| `infra/core/` | BQ dataset、service account、IAM、Secret Manager、GitHub Actions WIF (pulumi-ci SA) | (なし、最初) |
| `infra/ryan-product-graph/` (将来) | mcp-ryan-product-graph 用 Cloud Run、Cloud Scheduler | `core` |

## 共通方針

- 環境は **prod 1つのみ** (個人運用、staging は不要)。stack 名は `ryan`
- 全リソース location: `asia-northeast1`
- secret: Pulumi config `--secret` で stack file に保管、または Secret Manager
- IAM: `ryan-self-management` プロジェクト内に閉じる、最小権限

## quick start

```bash
# 初期セットアップ (会社/個人 gcloud 切替)
direnv allow
gcloud config configurations list  # ryan-personal が ACTIVE であることを確認

# stack 作成 + apply
cd infra/core
pulumi stack init ryan
pulumi up
```

## stack output → 利用先

`infra/core` は次を出力する想定:

- `bqDatasetId`: 例 `ryan`
- `graphServiceAccountEmail`: app から BQ 書き込みに使う SA
- `graphServiceAccountKey` (secret): `apps/graph/` がローカル開発で使う JSON key
- `pulumiCiServiceAccountEmail`: GitHub Actions Pulumi runner SA のメールアドレス (`google-github-actions/auth@v2` の `service_account` に指定)
- `githubWifProviderResource`: WIF provider のリソース名 (`google-github-actions/auth@v2` の `workload_identity_provider` に指定)

これらを `apps/graph/product/scripts/init-bq.ts` 等が参照する。`pulumiCiServiceAccountEmail` / `githubWifProviderResource` は GitHub Actions workflow の `google-github-actions/auth@v2` ステップで参照する。

## 関連

- [DESIGN.md](../DESIGN.md) — 全体方針
- [product-graph/README.md](../product-graph/README.md) — graph 用インフラ要件
