# Grafana Cloud admin policy セットアップ

`infra/core/` の Pulumi pipeline は Grafana Cloud Access Policy admin token (`grafana-cloud-admin-token`) を起点に、OTLP write policy / Stack Admin SA / Frontend Observability App / collector URL secret を declarative に派生作成する。本書は **その admin policy を Grafana Cloud Portal で作成するときの必須要件** をまとめる。誤った設定で投入すると Pulumi up が途中で 403 / `request not authorized for stack` で落ちる。

## なぜ重要か

`grafana-cloud-admin-token` の region と scope は、Pulumi 側からは検証できない (token 文字列だけが GCP Secret Manager に入る)。Cloud Portal での作成段階で間違えると、Pulumi が走るタイミングまで気付けず、再発時のデバッグも難しい。本書は「`pulumi up` を初回 / token rotation で叩く前に Ryan が踏む手順」のチェックリスト。

## region は stack と同じにする

Grafana Cloud Access Policy は **region scoped**。Cloud Portal API は region 跨ぎでも token を受け付けるが、**Frontend Observability management API は token と stack が同 region でないと `request not authorized for stack: failed to get Grafana Cloud Stack information` を返す**。

self-management の stack `ryantsuji` は `prod-ap-northeast-0` (= Tokyo) で動いているため、admin policy も `prod-ap-northeast-0` で作る必要がある。

Cloud Portal UI には明示的な region picker がない (Create access policy ダイアログに region drop-down が無い) — region は Realms の選び方で自動決定される:

| Realms 選択 | 配置される region |
|---|---|
| stack `ryantsuji` を直接選択 | **stack 自身の region (= `prod-ap-northeast-0`)** |
| `ryantsuji (all stacks)` (= org realm) | org default region (= `us`) |

→ admin token 用 policy は **Realms で stack `ryantsuji` を直接選ぶ** こと。`all stacks` は組織横断的に見えるが、結果として `us` region に固定されて FO API が通らない。

## 付与する scope

Cloud Portal UI の scope picker (Read / Write / Delete checkbox) で以下を check:

| Resource | Read | Write | Delete | 用途 |
|---|---|---|---|---|
| `accesspolicies` | ✓ | ✓ | ✓ | Pulumi が OTLP write 用 Access Policy / Token を CRUD |
| `stacks` | ✓ | | | `cloud.getStack` で stack 情報取得 |
| `stack-service-accounts` | | ✓ | | Stack 内 Admin SA (`pulumi-stack-admin`) 作成 |
| `frontend-observability` | ✓ | ✓ | ✓ | Faro App を CRUD (provider docs の `apps:*` は Cloud Portal scope picker 上では `frontend-observability:*` と表示される label mismatch あり) |
| `metrics` / `logs` / `traces` / `profiles` | | (✓ optional) | | OTLP write 用 access policy の scope と一致させる継承用。必須ではない (OTLP write policy 側で別途発行されるため) |

`oauth-tokens:*` / `repository-tokens:*` は **org-level scope のみ存在** し、stack realm の policy では選択肢に出てこない (= 仕様)。本リポジトリの Pulumi pipeline は org-level scope を要求しないため問題ない。

## 投入手順

1. **Cloud Portal で policy 作成**
   - Access Policies 画面 → Create access policy
   - Display name: `pulumi-admin` (任意)
   - Realms: **stack `ryantsuji` を直接選択** (`all stacks` は選ばない)
   - 上記表の scope を全て check
2. **policy 配下に token 発行**
   - 作成された policy の "Add token" → token 名は任意 (例: `pulumi-admin`)
   - 表示された token 文字列を clipboard にコピー (再表示不可)
3. **Secret Manager に投入**
   ```bash
   pbpaste | gcloud secrets versions add grafana-cloud-admin-token \
     --data-file=- --project=ryan-self-management
   ```
   `Created version [N]` が出れば OK
4. **Pulumi up で検証**
   ```bash
   cd infra/core
   pnpm exec pulumi up --yes --skip-preview
   ```
   `grafana:cloud:StackServiceAccount` / `grafana:frontendObservability:App` / `gcp:secretmanager:SecretVersion grafana-faro-collector-url-v1` が新規 create で成功すれば配線完了

## token rotation

token を rotation する時は **既存 policy 配下で新 token を発行** (policy 自体は触らない) → 同手順で Secret Manager に v2+ を投入 → `pulumi up` (Pulumi は latest version を読むので code 変更不要)。古い token は Cloud Portal 側で deactivate。

## トラブルシューティング

### `request not authorized for stack: failed to get Grafana Cloud Stack information`

`frontendObservability.App` の create でこのエラー = admin token の **region mismatch** が最も濃厚 (scope ではなく region。scope が足りないと別 error message になる)。Cloud Portal で policy の region badge を確認し、`prod-ap-northeast-0` 以外なら本書の通り作り直し → Secret Manager v2 投入 → `pulumi up` 再実行。

### `403 Forbidden: provider=grafana@X.Y.Z` (StackServiceAccount creating)

scope に `stack-service-accounts:write` が無い。policy edit で add → 既存 token そのまま使える (scope 拡張は token rotation 不要)。

### Pulumi up が `cloud_access_policy_token` / `frontend_o11y_api_access_token` の missing config を訴える

`infra/core/grafana-faro.ts` の `stackProvider` の field 設定 issue。コード側の問題 (Cloud Portal 側ではない) — `cloudAccessPolicyToken` と `frontendO11yApiAccessToken` の両方が provider config に渡っていることを確認。
