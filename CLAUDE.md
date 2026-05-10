# self-management — Claude 向けプロジェクトルール

このリポジトリで作業する際の **絶対遵守ルール**。例外は明示許可がない限り存在しない。

## 1. `--no-verify` 禁止 (例外なし)

`git commit --no-verify` / `git commit -n` / `git push --no-verify` / `--no-gpg-sign` 等の hook bypass 系 flag は **絶対禁止**。Ryan が明示的に "今回だけ" と許可しない限り使わない。

**Why:** pre-commit / commit-msg / pre-push hooks (secret scan / @graph-* タグ check / 行数 cap / 抑制コメント禁止 / commitlint) は本リポジトリのコード品質と Product Graph 整合性の最終防衛線。1 回の bypass は次の bypass を呼ぶ。

**Hook が落ちたら:**
- 根本原因を直す。bypass は答えではない
- secret-check 誤検出 → `scripts/hooks/secret-check.sh` のパターンを fix
- @graph-* check 誤検出 → `scripts/hooks/check-graph-tags.ts` を fix
- 行数 cap で詰まる → ファイル分割
- commitlint で詰まる → コミットメッセージを直す

## 2. 抑制コメント禁止 (例外なし)

`eslint-disable` / `@ts-ignore` / `@ts-nocheck` / `@ts-expect-error` / `prettier-ignore` / `biome-ignore` は **絶対禁止**。`scripts/hooks/check-no-ignore.sh` で機械強制。型エラー / lint エラーは抑制ではなく構造で解く。

例外: markdown 内で「禁止コメント」を**説明する**目的の記述のみ許容。

## 3. `@graph-*` JSDoc タグ必須

`apps/`, `packages/`, `infra/` 配下の `.ts` / `.tsx` ファイルは:
- ファイル先頭 JSDoc に `@graph-stack` / `@graph-domain` / `@graph-business` / `@graph-connects` 必須
- 全トップレベル宣言 (export / const / function / class) に `@graph-connects` 必須 (接続なしなら `none`)

`@graph-stack` / `@graph-domain` の値は `scripts/hooks/check-graph-tags.ts` の `STACKS` / `DOMAINS` enum と一致させる。新規 stack / domain を追加する時はその enum を先に更新。

## 4. ファイル行数上限 500 行

コード行 (コメント・空行除く) で 500 行を超えるファイルは禁止。`scripts/hooks/check-line-count.ts` で機械強制。超過したらファイル分割。

**例外**: テストファイル (`*.test.{ts,tsx,js,jsx,mjs,cjs}` / `*.spec.*`) は cap 対象外。inline snapshot で各 case の網羅により行数が自然に伸びるため、cap は実装ファイルにのみ適用する。

## 5. インフラは Pulumi で集約管理

GCP リソース (API enable / IAM / BQ / SA / Cloud Run / etc.) は **Pulumi 経由でのみ管理**。`gcloud projects add-iam-policy-binding` 等の手動 CLI 操作で drift を作らない。

例外的に手動操作した場合は、その日のうちに Pulumi state へ統合し drift をゼロに戻す。

## 6. 認証パターン

- ADC (user account) は使わない。`GOOGLE_APPLICATION_CREDENTIALS=$PWD/.config/gcp-sa.json` 経由の SA key で API を叩く
- direnv が `.envrc` で env を切替えるので、ディレクトリに入るだけで自動切替
- `gcloud` CLI は `CLOUDSDK_ACTIVE_CONFIG_NAME=ryan-personal` で個人 config に
- 例外: Pulumi 初回 setup や IAM admin 操作だけは user ADC を一時的に使う

## 7. コミットメッセージ

Conventional Commits 形式 (`feat:` / `fix:` / `chore:` / `docs:` / `refactor:` / `test:` 等)。
- type は小文字
- subject 末尾にピリオドなし
- ヘッダー 100 字以内
- `commitlint.config.js` で機械強制

詳細運用ガイドは `docs/DESIGN.md` / `docs/guidelines/` 参照。
