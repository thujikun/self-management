# infra/ryantsuji-dev

ryantsuji.dev (個人ブログ) の Cloudflare インフラ。

## 中身 (現状)

- Cloudflare zone の lookup (CF Registrar で取得済の `ryantsuji.dev`)
- Google Search Console domain verification 用 apex TXT record
  (`google-site-verification=<token>`、`pulumi import` で取り込み済)
- Google Workspace 受信メール DNS record 一式 (`pulumi import` で取り込み済):
  - MX × 5 (`aspmx.l.google.com` P=1 + `alt[1-4].aspmx.l.google.com` P=5/5/10/10)
  - SPF TXT (`v=spf1 include:_spf.google.com ~all`)
  - DKIM TXT (`google._domainkey` に 2048bit RSA 公開鍵、multi-string 形式)
  - Workspace domain verification TXT (Search Console とは別 token)
- Cloudflare Workers custom domain binding × 2 (`pulumi import` で取り込み済):
  - apex `ryantsuji.dev` → Worker `ryantsuji-dev-web`
  - `www.ryantsuji.dev` → Worker `ryantsuji-dev-web`
  - 付随する AAAA `100::` placeholder record は CF backend が binding lifecycle に
    従属して自動管理するため `cloudflare.DnsRecord` で別管理しない (二重管理すると
    destroy 時 race condition のリスク)
- stack output: `zoneId`, `zoneNameOut`, `googleSiteVerificationRecordId`,
  `googleSpfRecordId`, `googleDkimRecordId`, `googleWorkspaceVerificationRecordId`,
  `googleWorkspaceMxRecordIds`, `workerCustomDomainIds`

## 後で追加するもの

- DMARC TXT (`_dmarc` に `p=none` で監視開始 → 後で `p=quarantine` 昇格)
- R2 bucket / KV namespace (記事キャッシュや draft 状態管理に使う場合)

## 初回 setup

```bash
# 1. Cloudflare API token を発行
#    https://dash.cloudflare.com/profile/api-tokens
#    現状の運用 token に必要な scope:
#    - Zone:Read + DNS:Read (zone lookup + DNS record import 用)
#    - Workers Scripts:Read (WorkersCustomDomain import 用)
#    書き換えは dashboard / wrangler 側で行い、Pulumi 側は `pulumi import` で state
#    を後追いする方針なので Edit 系 scope は不要。
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
pulumi config set ryantsuji-dev:cloudflareAccountId <account-id-from-dashboard>

# 4. Google Search Console verification token を config に登録
#    record 値はそのまま literal で渡す必要があるため shell 上で `"` を含めて quote する
#    (= YAML 側に `'"google-site-verification=…"'` のまま入る)。
#    値自体は dashboard で誰でも見れる public な検証用 nonce なので --secret 不要。
pulumi config set ryantsuji-dev:googleSiteVerification \
  '"google-site-verification=<token-from-search-console>"'

# 5. Google Workspace 関連 token を config に登録 (Workspace setup 済の場合のみ)
pulumi config set ryantsuji-dev:googleWorkspaceVerification \
  '"google-site-verification=<token-from-workspace-admin>"'
pulumi config set ryantsuji-dev:googleDkim \
  '"v=DKIM1;k=rsa;p=<chunk1>" "<chunk2>"'

# 6. preview & up
pulumi preview
pulumi up
```

## drift 取り込み workflow

### DNS record (dashboard で追加した record を Pulumi に取り込む)

```bash
# 1. CF dashboard で record を追加 (Workspace setup の画面案内に従う等)

# 2. 該当 record の Cloudflare record ID を取得
ZONE_ID=$(pulumi stack output zoneId)
curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?per_page=100" \
  | jq '.result[] | {id, type, name, content, priority}'

# 3. index.ts に `cloudflare.DnsRecord` を declarative に追記し、必要なら
#    Pulumi.ryan.yaml に config 値を追加

# 4. import file を書き state に取り込む
cat > /tmp/imports.json <<EOF
{
  "resources": [
    { "type": "cloudflare:index/dnsRecord:DnsRecord",
      "name": "<resource-name-in-index.ts>",
      "id": "$ZONE_ID/<cloudflare-record-id>" }
  ]
}
EOF
pulumi import --file /tmp/imports.json --generate-code=false --yes

# 5. drift が消えたことを確認
pulumi preview   # → "N unchanged" のみで diff 系出力がなければ OK
```

### Workers custom domain binding (wrangler deploy で追加した binding を Pulumi に取り込む)

```bash
# 1. wrangler.jsonc の routes[].custom_domain で hostname を追加し `wrangler deploy`
#    (binding 自体は wrangler が CF に登録する → Pulumi は state 反映のみ担当)

# 2. account ID と binding ID を取得
ACCOUNT_ID=$(pulumi config get cloudflareAccountId)
curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/domains" \
  | jq '.result[] | select(.zone_name == "ryantsuji.dev") | {id, hostname, service}'

# 3. index.ts の WORKER_CUSTOM_DOMAINS array に entry 追加

# 4. import file を書き state に取り込む
cat > /tmp/imports.json <<EOF
{
  "resources": [
    { "type": "cloudflare:index/workersCustomDomain:WorkersCustomDomain",
      "name": "<resource-name-in-index.ts>",
      "id": "$ACCOUNT_ID/<binding-id>" }
  ]
}
EOF
pulumi import --file /tmp/imports.json --generate-code=false --yes

# 5. drift 確認
pulumi preview
```

## 注意

- CF Registrar での zone 取得は **dashboard でのみ可能** (CF API に register endpoint がない)
- そのため zone そのものは Pulumi 管理外、ここでは既存 zone を lookup する形で参照する
- DNS record は dashboard で write → Pulumi import で取り込む方針 (token に DNS:Edit 不要)
- Workers custom domain binding は wrangler deploy で write → Pulumi import で取り込む方針
  (token に Workers Scripts:Edit 不要)
- Workers binding に付随する AAAA `100::` placeholder record は CF backend が
  binding lifecycle に従属して自動管理するため `cloudflare.DnsRecord` で別管理しない
- drift は出ない (Pulumi が書き換えない、import で state を後追いする運用)
