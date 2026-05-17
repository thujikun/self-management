# 可観測性

self-management の app から Grafana Cloud (個人 stack `ryantsuji`) + BigQuery に流す observability signal の経路と、データが届かない時の debug runbook。

経路の wiring 設計詳細は各 app 配下 file の JSDoc (`@graph-business` / `@graph-connects`) が SSoT。本ディレクトリは「外部システム (Cloud Portal / Tempo / Loki / BQ console / browser devtools) から見て何を確認するか」の人間向け runbook を per-app で集約する。

## 一覧

| app | doc |
|---|---|
| `apps/ryantsuji-dev/web` (ryantsuji.dev) | [ryantsuji-dev-web.md](./ryantsuji-dev-web.md) |

## 関連

- [`docs/infra/grafana-cloud-setup.md`](../infra/grafana-cloud-setup.md) — Grafana Cloud admin policy 作成手順 (Pulumi 配線の前提)
