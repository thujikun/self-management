# infra/ryantsuji-dev

ryantsuji.dev (個人ブログ) の Cloudflare インフラ。

## 中身 (現状)

- Cloudflare zone の lookup (CF Registrar で取得済の `ryantsuji.dev`)
- Google Search Console domain verification 用 apex TXT record
  (`google-site-verification=<token>`、`pulumi import` で取り込み済)
- stack output: `zoneId`, `zoneNameOut`, `googleSiteVerificationRecordId`

## 後で追加するもの

- `cloudflare.WorkerCustomDomain` で `ryantsuji.dev` を Worker `ryantsuji-dev-web` に bind
- 必要なら `www` → apex CNAME 等の追加 DNS record
- R2 bucket / KV namespace (記事キャッシュや draft 状態管理に使う場合)

## 初回 setup

```bash
# 1. Cloudflare API token を発行
#    https://dash.cloudflare.com/profile/api-tokens
#    現状の運用 token に必要な scope: Zone:Read + DNS:Read
#    (DNS は dashboard で書き、Pulumi 側は `pulumi import` で取り込む方針なので Edit 不要)
#    後で `cloudflare.WorkerCustomDomain` を追加するタイミングで
#    `Workers Scripts:Edit + Workers Routes:Edit` を足す。
#    token は GCP Secret Manager の `cloudflare-api-token` container に格納し、
#    `.envrc` 経由で `CLOUDFLARE_API_TOKEN` env var として auto export される
#    (SSoT は Secret Manager、`pulumi config set --secret cloudflare:apiToken` 不要)。

# 2. Pulumi backend (個人 use なので local file backend)
pulumi login --local

# 3. stack 作成
cd infra/ryantsuji-dev
pnpm install
pulumi stack init ryan
pulumi config set ryantsuji-dev:zoneName ryantsuji.dev

# 4. Google Search Console verification token を config に登録
#    record 値はそのまま literal で渡す必要があるため shell 上で `"` を含めて quote する
#    (= YAML 側に `'"google-site-verification=…"'` のまま入る)。
#    値自体は dashboard で誰でも見れる public な検証用 nonce なので --secret 不要。
pulumi config set ryantsuji-dev:googleSiteVerification \
  '"google-site-verification=<token-from-search-console>"'

# 5. preview & up
pulumi preview
pulumi up
```

## 注意

- CF Registrar での zone 取得は **dashboard でのみ可能** (CF API に register endpoint がない)
- そのため zone そのものは Pulumi 管理外、ここでは既存 zone を lookup する形で参照する
- drift は出ない (zone settings を Pulumi で書き換えていないため)
