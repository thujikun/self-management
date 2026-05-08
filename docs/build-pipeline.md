# build pipeline

`pnpm build` から走る turbo 経由のビルドパイプラインの SSoT。turbo cache の入出力契約、なぜ test/lint/typecheck を turbo 化していないか、どの package が何を build するかを 1 箇所に集約する。

## 全体像

```
pnpm build  ─►  turbo run build  ─►  per-package `pnpm build`
                                       ├─ @self/graph-product   (tsc)
                                       ├─ @self/ryantsuji-dev-web (vite build)
                                       ├─ @self/design-tokens   (tsc)
                                       └─ @self/db              (tsc)
```

`build` task 以外 (test / lint / typecheck / format) は **turbo を経由しない**。理由は後述「turbo 化していないタスク」参照。

## turbo 設定の場所

| ファイル | 役割 |
|---|---|
| `turbo.json` (root) | 全 package 共通の `build` task / `globalDependencies` / 共通 `inputs` |
| `apps/ryantsuji-dev/web/turbo.json` | web 固有の `inputs` (vite.config.ts / wrangler.jsonc) を上書き |

per-package `turbo.json` は `extends: ["//"]` で root を継承し、その package だけに必要な input/output を足す。graph-product / design-tokens / db は root の inputs (src/** + tsconfig.json + package.json) で足りるため per-package 設定なし。

## キャッシュ契約

### globalDependencies

ルート `turbo.json:globalDependencies` に列挙されたファイルは **どの package を build する時もキャッシュキーに含める**。これらが変わると全 package のキャッシュが invalidate する。

- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `tsconfig.base.json`

### inputs (per-task / per-package)

入力ファイル globs。**変わるとその package のキャッシュが invalidate する**。

ルート `build` task の inputs:

```
src/**
tsconfig.json
package.json
```

`apps/ryantsuji-dev/web/turbo.json` の追加 inputs:

```
vite.config.ts
wrangler.jsonc
```

> [!important]
> `inputs` を絞れば絞るほど cache hit rate が上がる。逆に「念の為」入れ過ぎると毎回 cache miss する。例: `apps/graph/product/tsconfig.json` の `exclude` に `scripts` が入っているので、`scripts/**` を inputs に含めると `scripts/x-log.ts` 編集のたびに graph-product の build cache が無効化されるが build 出力は変わらない、という無駄が出る。

### outputs (per-task)

build が生成するファイル globs。`turbo run build` の cache hit 時、ここに列挙されたパスから restore される。

ルート `build` task の outputs:

```
dist/**
```

`@self/ryantsuji-dev-web` も含めて全 package が `dist/` を出力するため共通定義で足りる (TanStack Start v1.167+ で `.output/` は不使用)。

## 開発時の使い方

```bash
# 通常 build (cache 効く)
pnpm build

# cache を全無視して fresh build (debugging 用)
pnpm build:force      # = turbo run build --force
```

`turbo run build --force` は cache hit を**無視して再実行する**が、cache 書き込みは行うことに注意 (read のみ bypass / write は通常)。read/write 両方 bypass したいなら `--force --no-cache` を直接渡す。

## turbo 化していないタスク

以下は `pnpm <task>` がそのまま実行系を呼び出し、turbo を経由しない。理由:

| task | 実装 | 理由 |
|---|---|---|
| `test` | `vitest run` (root から全 workspace 横断) | vitest config が単一・全 workspace 横断で集計するため per-package 化の利得がない |
| `test:coverage` | `vitest run --coverage` | 同上、`perFile: 90%` 閾値も root vitest.config.ts で一元管理 |
| `lint` / `lint:fix` | `eslint . --max-warnings=0` | flat config 1 つで完結、ファイル数依存だが micro-bench では turbo overhead の方が大きい |
| `format` / `format:check` | `prettier --write/--check .` | 同上 |
| `typecheck` | `pnpm -r typecheck` (各 package で `tsc --noEmit`) | 全 package 並列実行で十分速く、Project References を導入していないので turbo cache 化の利得が小さい。将来 cold typecheck が遅くなったら turbo 化を検討 |

将来 monorepo が拡大して上記の判断が逆転したら、本ファイルに移行決定とその理由を追記する。

## 変更時のレビュー観点

`turbo.json` (root or per-package) を編集する PR では以下を必須チェック:

- [ ] **inputs** に追加したパス → ホントにビルド出力に影響するか確認 (影響しない glob は cache hit rate を下げるだけ)
- [ ] **outputs** に追加したパス → ホントに `pnpm build` がそのパスに書き込むか (実際生成されないパスは cache restore で空ディレクトリを作るだけ)
- [ ] 新規 `build` script を追加した package → root or per-package turbo.json で `inputs/outputs` が正しく宣言されているか
- [ ] cold build で `Cached: 0` / 何も触らず再実行で `FULL TURBO` を目視確認

## 参考

- turbo docs: https://turborepo.com/docs/reference/configuration
- `pnpm-workspace.yaml`: workspace 構成の SSoT
- `tsconfig.base.json`: 全 package が extend する TS 共通設定 (globalDependencies)
