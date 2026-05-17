# セキュリティ

self-management の secret 管理 (Pulumi config / Secret Manager / `.envrc` / `.config/gcp-sa.json`) と CF / Neon / Upstash 連携を前提とするセキュリティルール。

## チェック観点

### 認証・認可

- [ ] CLAUDE.md rule 6 に従い、ADC (user account) を業務処理で使っていないか — `GOOGLE_APPLICATION_CREDENTIALS=$PWD/.config/gcp-sa.json` 経由の SA key で API を叩く
- [ ] `gcloud` CLI を使うコードが `CLOUDSDK_ACTIVE_CONFIG_NAME=ryan-personal` 配下になっているか
- [ ] 例外的に user ADC を使う箇所 (Pulumi 初回 setup / IAM admin) が明示的にコメント / docs で示されているか
- [ ] CF API token の scope が最小権限になっているか (`Zone:Read` / `Zone DNS:Edit` / `Account Workers Scripts:Edit` の必要なものだけ)

### Secret 管理

- [ ] secret は次のいずれかで管理されているか:
  - **Pulumi config (encrypted)**: `pulumi config set --secret <namespace>:<key> <value>` で `Pulumi.<stack>.yaml` に `secure:` フィールドとして暗号化保存
  - **Secret Manager**: GCP Secret Manager に格納し、SA に `roles/secretmanager.secretAccessor` を付与してランタイムで読み込む
  - **`.envrc`**: gitignore 済み、direnv 経由で env var として展開 (CF API token / Neon DSN 等)
  - **`.config/gcp-sa.json`**: SA key、gitignore 済み、`GOOGLE_APPLICATION_CREDENTIALS` から参照
- [ ] secret 本体がソースコード / docs / commit message / Pulumi state output / Sheets 出力 / ログにハードコード or 出力されていないか
- [ ] Firestore / BQ / Neon に secret 本体が平文で保存されていないか — Secret Manager の参照 ID (例: `xxxSecretId`) だけ保存する
- [ ] 機密情報 (パスワード / API key / OAuth client secret / 秘密鍵 / Webhook secret) の保存・配布に Secret Manager を使用しているか
- [ ] Secret Manager を読む SA / IAM が最小権限になっているか (必要な runtime SA のみに `roles/secretmanager.secretAccessor` を付与)

### IAM / SA

- [ ] Cloud Run / Cloud Functions / Cloud Scheduler の SA 権限が最小権限原則に従っているか
- [ ] SA に不要な IAM ロールが付与されていないか (未付与でサイレント失敗するケースあり、逆に過剰付与も問題)
- [ ] Pulumi の `infra/core/index.ts` / `infra/ryantsuji-dev/index.ts` で IAM binding が role 単位で明示されているか (broad な `roles/owner` などは使わない)
- [ ] CLAUDE.md rule 5 に違反する手動 IAM 付与 (`gcloud projects add-iam-policy-binding ...`) で drift を作っていないか

### 入力検証

- [ ] ユーザー入力 / 外部 API レスポンス / 環境変数 / Secret 値が境界で **Zod スキーマ** で検証されているか
- [ ] 必須値をフォールバックで隠さず、設定不整合を早期に失敗させているか
- [ ] BQ / Postgres クエリでパラメータ化を使用しているか (string 結合での SQL は禁止)
- [ ] 認証・認可・権限のチェックが呼び出し元任せになっていないか (各 endpoint / handler 側で必ずチェック)

### CF / Workers 固有

- [ ] CF Workers route に必要な `compatibility_flags` (`nodejs_compat` 等) が `wrangler.jsonc` で明示されているか
- [ ] `wrangler.jsonc` の `vars` / `secrets` (binding) が secret を含む場合、secret 本体ではなく Secret Manager 参照や `.dev.vars` (gitignore) 経由になっているか
- [ ] CF API token を `wrangler` と Pulumi で使い回す場合、scope が両方の用途を満たしているか (Workers Scripts:Edit + Zone:Read 等)

### Neon / Upstash

- [ ] Neon DSN を `.envrc` または Pulumi config (Hyperdrive 経由) で管理しているか
- [ ] Upstash REST URL / token が `.envrc` または Pulumi config 経由か
- [ ] Hyperdrive を使う場合、CF binding として宣言され、ランタイムでは binding 経由のみアクセスしているか

### LLM / 外部 API

- [ ] Vertex AI SDK の初期化パラメータが正しいか (`vertexai: true` がないと Google AI Studio に向く)
- [ ] LLM 呼び出しのエラーが握りつぶされていないか (サイレント失敗の原因になる)
- [ ] X / Zenn / dev.to / Hashnode 等の外部 API token が `.envrc` または Secret Manager 経由か
- [ ] xmcp 直叩きが過去 post / 関係性検索に使われていないか (CLAUDE.md rule 8 違反、コスト直結)

### 抑制コメント / hook bypass (CLAUDE.md rule 1, 2)

- [ ] `eslint-disable` / `@ts-ignore` / `@ts-nocheck` / `@ts-expect-error` / `prettier-ignore` / `biome-ignore` が使用されていないか — 機械強制 (`scripts/hooks/check-no-ignore.sh`)、違反は **Critical**
- [ ] `git commit --no-verify` / `-n` / `--no-gpg-sign` 等で hook を bypass していないか — commit 履歴で検出可、違反は **Critical**

### Sheets / Slack 出力

- [ ] Sheets API の `USER_ENTERED` 使用時に数式インジェクションリスクがないか (ユーザー入力を `=...` として書き込まない)
- [ ] スプレッドシート ID / Slack channel ID がハードコードされていないか (env var or Pulumi config 経由)
- [ ] secret / token / password / 個人情報をログ / エラーメッセージ / Slack 通知 / Sheets 出力に出していないか

### ドキュメント・サンプル

- [ ] ドキュメント / テストデータ / サンプルコードに実物の secret を載せていないか (ダミー値のみ使用、e.g. `test-zone-id-1234567890`)
- [ ] README / DESIGN doc に CF account ID / GCP project ID 以外の secret を載せていないか

## 違反時の重要度

- 上記チェックの **secret hardcode / SA 過剰権限 / 認証回避 / 抑制コメント / hook bypass** はいずれも **Critical** (`REQUEST_CHANGES`)。
- それ以外 (Zod 検証漏れ / エラー握りつぶし / 入力検証不足) は **Major** が原則。
- 詳細は [severity.md](./severity.md) を参照。
