# 自動生成 catalog

このディレクトリは **将来的に自動生成される** catalog の置き場。

現時点では未実装。cortex の `docs/generated/` に対応する。

## 計画

| ファイル | 内容 | 生成元 |
|---------|------|--------|
| `app-catalog.md` | apps/ 配下の一覧と概要 | `apps/*/package.json` の description |
| `package-catalog.md` | packages/ 配下の一覧 | `packages/*/package.json` |
| `infra-stacks.md` | Pulumi stack 一覧 | `infra/*/Pulumi.yaml` |
| `service-accounts.md` | GCP service account 一覧 | Pulumi state |
| `bq-tables.md` | BQ dataset / table 一覧 | INFORMATION_SCHEMA |
| `graph-stats.md` | ryan-product-graph のノード/エッジ統計 | BQ |

実装は `apps/graph/product/scripts/build-catalogs.ts` 等で。
