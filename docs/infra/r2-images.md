# R2 画像配信 (ryantsuji-dev)

post 添付画像 (markdown 内の `![](/images/...)`) を Cloudflare R2 経由で配信する仕組み。
dev / prod で **同一 URL** で resolve するため、markdown 側は環境を意識せず
`![](/images/posts/<slug>/foo.png)` の形で書ける。

## 全体像

```
apps/ryantsuji-dev/web/content/images/<任意>/<file>
↓ (CI sync at deploy)
R2 bucket `ryantsuji-dev-images`
↓ (Worker /images/* route)
https://ryantsuji.dev/images/<任意>/<file>
```

local dev は CI sync を経由せず、`content/images/` から fs 直 read で serve する
(vite middleware)。

## ディレクトリ規約

| 規約 | 例 |
|------|----|
| 配置 | `apps/ryantsuji-dev/web/content/images/posts/<slug>/<name>.<ext>` |
| URL | `/images/posts/<slug>/<name>.<ext>` |
| 除外 | `_` / `.` で始まる file / dir は sync skip (`_manifest.json` sentinel と hidden 用 reserved) |
| 拒否 | `..` segment / 絶対 path (`/etc/...`) は dev / prod 両方で 404 (path traversal 防止) |

## 仕組み (dev / prod)

| 環境 | 経路 | Cache |
|------|------|-------|
| dev (`vite dev`) | `apps/ryantsuji-dev/web/vite-plugins/local-images.ts` middleware が `/images/*` を `content/images/` から fs 直 read | `Cache-Control: no-cache` |
| prod (CF Worker) | `apps/ryantsuji-dev/web/src/server.ts` の `fetch` handler が `/images/*` を TanStack Start 前に intercept、`apps/ryantsuji-dev/web/src/server-images.ts` が R2 binding `env.IMAGES` から serve | `Cache-Control: public, max-age=31536000, immutable` (+ HEAD 対応) |

prefix / key 抽出 (`imageKeyFromPath` / `r2KeyFromPath`) は両側で同一規則。dev で動く
markdown URL は prod でもそのまま動く。

## R2 への sync

`scripts/sync-r2-images.cli.ts` が `content/images/` を R2 bucket と diff し、変更分のみ
PUT する idempotent script。`_manifest.json` を bucket 上に保持する (schema v2:
`{ v: 2, local: {key→sha256}, orphans: [key, ...] }`)。

orphan (= local から消えたが R2 に残ったままの key) は manifest の `orphans` array に
**累積**される。複数 sync を跨いでも観測情報が消えず、毎 deploy log で warn が出続けるので、
人間が `wrangler r2 object delete` で物理削除 + manifest の該当 entry を手動で消すまで
監視され続ける設計。

`_manifest.json` 自体は Worker route で 404 になる (sentinel `_` prefix を `r2KeyFromPath`
が弾く)。bucket 内部 metadata が public 配信に漏れない。

CI deploy workflow (`.github/workflows/deploy-ryantsuji-dev.yml`) が **`wrangler deploy`
の直前** に呼ぶ:

- PR run: `--dry-run` で `toUpload` を log のみ (実 PUT はしない)
- main push: 実 PUT + `_manifest.json` 更新 → 後段の `wrangler deploy`

`orphan` (local に存在しない remote object) は警告 log のみ。物理削除は誤削除リスクを
避けて手動運用:

```bash
pnpm exec wrangler r2 object delete ryantsuji-dev-images/<key>
```

### 手動 sync

```bash
# CLOUDFLARE_API_TOKEN (Workers R2 Storage Write 権限) と
# CLOUDFLARE_ACCOUNT_ID を env に置く
export CLOUDFLARE_API_TOKEN=$(gcloud secrets versions access latest --secret=cloudflare-api-token)
export CLOUDFLARE_ACCOUNT_ID=f663c304d75d993808307902afd027f7

pnpm exec tsx scripts/sync-r2-images.cli.ts --dry-run   # 確認
pnpm exec tsx scripts/sync-r2-images.cli.ts             # 実行
```

## 初回 setup (1 度だけ)

1. **Pulumi 用 CF token に R2 scope 追加**: `cloudflare-api-token` (GCP Secret Manager)
   に **`Workers R2 Storage Write`** 権限を付与。これがないと `pulumi up` の R2Bucket
   作成が `Authentication error` で失敗する
2. **`pulumi up`** (`infra/ryantsuji-dev`) で `cloudflare.R2Bucket("ryantsuji-dev-images")`
   を apply (`location=apac`, `storageClass=Standard`)
3. **GitHub Actions repo vars** に `CLOUDFLARE_ACCOUNT_ID` を追加 (`https://github.com/<owner>/<repo>/settings/variables/actions` で `New repository variable`、value は `f663c304d75d993808307902afd027f7`)
4. **deploy workflow** が走れば初回 sync が走る (`_manifest.json` 不在 ⇒ 全 file PUT)

## 関連 file

| file | 役割 |
|------|------|
| `infra/ryantsuji-dev/index.ts` | R2 bucket `ryantsuji-dev-images` の Pulumi declaration |
| `apps/ryantsuji-dev/web/wrangler.jsonc` | Worker の R2 binding `IMAGES` |
| `apps/ryantsuji-dev/web/src/start.ts` | Env interface に `IMAGES: R2Bucket` |
| `apps/ryantsuji-dev/web/src/server.ts` | `/images/*` を TanStack 前に intercept |
| `apps/ryantsuji-dev/web/src/server-images.ts` | R2 binding から serve (pure logic) |
| `apps/ryantsuji-dev/web/vite-plugins/local-images.ts` | dev fs middleware |
| `scripts/sync-r2-images.ts` (+ `.cli.ts`) | manifest diff + PUT |
| `.github/workflows/deploy-ryantsuji-dev.yml` | CI sync step |
| `apps/ryantsuji-dev/web/content/images/` | 配置先 (この dir 配下が R2 と同期する SoT) |
