# infra/ryantsuji-dev

ryantsuji.dev (個人ブログ) の Cloudflare インフラ。

## 中身 (現状)

- Cloudflare zone の lookup (CF Registrar で取得済の `ryantsuji.dev`)
- `zoneId` を stack output として export

## 後で追加するもの

- `cloudflare.WorkerCustomDomain` で `ryantsuji.dev` を Worker `ryantsuji-dev-web` に bind
- 必要なら `cloudflare.Record` で `www` → apex CNAME / TXT (verification) など
- R2 bucket / KV namespace (記事キャッシュや draft 状態管理に使う場合)

## 初回 setup

```bash
# 1. Cloudflare API token を発行
#    https://dash.cloudflare.com/profile/api-tokens
#    必要な scope: Zone:Read, DNS:Edit, Workers Scripts:Edit
#    (Workers Scripts:Edit は今は使わないが、後で WorkerCustomDomain 追加時に必要)

# 2. Pulumi backend (個人 use なので local file backend)
pulumi login --local

# 3. stack 作成
cd infra/ryantsuji-dev
pnpm install
pulumi stack init ryan
pulumi config set --secret cloudflare:apiToken <CF_API_TOKEN>
pulumi config set ryantsuji-dev:zoneName ryantsuji.dev

# 4. preview & up
pulumi preview
pulumi up
```

## 注意

- CF Registrar での zone 取得は **dashboard でのみ可能** (CF API に register endpoint がない)
- そのため zone そのものは Pulumi 管理外、ここでは既存 zone を lookup する形で参照する
- drift は出ない (zone settings を Pulumi で書き換えていないため)
