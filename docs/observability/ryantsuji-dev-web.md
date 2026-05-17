# ryantsuji-dev-web の可観測性

`apps/ryantsuji-dev/web` (= ryantsuji.dev の CF Workers app) から Grafana Cloud (個人 stack `ryantsuji`) + BigQuery (`ryan.web_events`) に observability signal を流す経路と、データが届かない時の debug 手順。

経路の wiring 設計詳細は各 file の JSDoc (`@graph-business` / `@graph-connects`) が SSoT。本書は「外部システム (Cloud Portal / Tempo / Loki / BQ console / browser devtools) から見て何を確認するか」の人間向け runbook。

## 経路 overview

| layer | signal | コード起点 | 送信先 | 配線 secret |
|---|---|---|---|---|
| server (CF Workers) | trace span (incoming + outbound fetch) | `src/server.ts` の `instrument()` wrap | Grafana Cloud Tempo (`grafanacloud-ryantsuji-traces`) | `OTLP_ENDPOINT` + `OTLP_AUTH_HEADER` (wrangler secret) |
| client (browser) | RUM event (page load / web-vital / unhandled error / fetch tracing) | `src/lib/faro-client.ts:initFaro` (`__root.tsx` の useEffect から 1 回起動) | Grafana Cloud Frontend Observability (`grafanacloud-ryantsuji-logs` 配下の Faro app) | `VITE_FARO_COLLECTOR_URL` (build 時 vite inline) |
| client → server → BQ | analytics event (page_view 等) | `src/lib/track-client.ts:trackPageView` → `navigator.sendBeacon` → `POST /api/track` → `src/server/bq-track.ts` | BigQuery `ryan.web_events` (Pulumi 管理 table) | `GCP_SA_JSON` (wrangler secret) + `BQ_PROJECT_ID` / `BQ_DATASET` / `BQ_TABLE` (wrangler vars) |

3 経路とも **fail-open 設計** — secret 未投入 / 送信失敗いずれでも request handler は通常 response を返す。

## 自前 analytics の追加メモ (`/api/track` → BQ `ryan.web_events`)

`bq-track.ts` の経路は **SA JSON → RS256 JWT 署名 → OAuth2 access token → `tabledata.insertAll`** の 4 段。

- payload: `path` / `slug` / `lang` / `referrer` / `utm_*` / `viewport_w/h` / `locale` / `session_id` (sessionStorage UUID、cookie 不使用で tab close で揮発)
- server 付与: `ts` (server time) / `user_agent` (256 char truncate)
- fail-open: SA 未投入 / token exchange 失敗 / `insertAll` 失敗いずれも `/api/track` は 204 を返し、server 側で OTel span event `track.bq.fail` を emit するのみ (client request は止めない)
- token cache: `getAccessToken` が isolate scope で 1 つ持ち、cold-start 直後の並列 request では in-flight Promise を共有して OAuth 経路は 1 回に集約

## debug runbook

### 「BQ `ryan.web_events` にデータが来ない」

1. `pnpm exec wrangler secret list` に `GCP_SA_JSON` が入っているか確認
2. Tempo の span (`grafanacloud-ryantsuji-traces`) で `track.bq.fail` event が出ていないか確認 — `reason` field で `parse-sa-json` / `parse-input` / `build-row` / `oauth-or-insert` を区別できる
3. BQ console の `ryan.web_events` table preview に直近行が乗っているか確認 (`bq query --use_legacy_sql=false "SELECT * FROM ryan.web_events ORDER BY ts DESC LIMIT 5"`)

### 「Tempo に server trace / Faro Frontend Observability に RUM 来ない」

1. Worker secrets に `OTLP_ENDPOINT` / `OTLP_AUTH_HEADER` が入っているか — `pnpm exec wrangler secret list`
2. 直近 deploy 時の `VITE_FARO_COLLECTOR_URL` が build 時に注入されたか — GitHub Actions log の "Fetch VITE_FARO_COLLECTOR_URL from Secret Manager" step
3. browser devtools network panel で `faro-collector*` への beacon が出ているか (Faro 側)
4. Tempo 側で `service.name = "ryantsuji-dev-web"` の trace を検索 (`grafanacloud-ryantsuji-traces` datasource)

## 関連

- [`infra/core/grafana-faro.ts`](../../infra/core/grafana-faro.ts) — Faro App / Stack SA / collector URL secret の Pulumi 配線
- [`docs/infra/grafana-cloud-setup.md`](../infra/grafana-cloud-setup.md) — admin policy 作成手順 (Pulumi 配線の前提)
- [`apps/ryantsuji-dev/web/README.md`](../../apps/ryantsuji-dev/web/README.md) — app 全体の構成 (deploy / endpoint 等)
