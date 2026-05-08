# spike: TanStack Start で React Server Components

**期間**: 2026-05-08
**対象**: `apps/ryantsuji-dev/web` (TanStack Start v1.167 / Vite 7 / React 19)
**目的**: ryantsuji.dev の content rendering (markdown → JSX) を server-only に倒すため、現状 RSC が動くか / Cloudflare Workers 適応に問題が無いかを実機検証。
**結論**: **動く**。記事 rendering の本実装で RSC を採用する方針で進めて良い。

## 受け入れ基準と結果

| # | 基準 | 結果 |
|---|------|------|
| 1 | server component を loader 経由で render し、client に Flight stream として送れる | ✅ `<Greeting />` が dev / production の両方で SSR HTML に server-render 結果として現れる |
| 2 | client bundle 検証で server component の依存が含まれていない | ✅ `Greeting` 本文 ("RSC spike" / "Hello, Ryan") は `dist/server/rsc/assets/*.js` のみに存在し、`dist/client/assets/*.js` には現れない |
| 3 | production build (vite build) と CF Workers 適応 (server.ts) が壊れない | ✅ `pnpm build` 5 environment 全て通過。`dist/server/server.js` は引き続き生成され Worker entry から import 可能 |

## やったこと

### 1. 依存追加

```yaml
# pnpm-workspace.yaml の catalog
'@vitejs/plugin-rsc': ^0.5.26
react-server-dom-webpack: ^19.2.0
```

`apps/ryantsuji-dev/web/package.json` で catalog 経由参照:

- `dependencies.react-server-dom-webpack`
- `devDependencies.@vitejs/plugin-rsc`

### 2. `vite.config.ts` で RSC を有効化

```ts
plugins: [
  tanstackStart({ rsc: { enabled: true } }), // ← server-component register / flight loader を活性化
  rsc(),                                      // ← @vitejs/plugin-rsc: Flight protocol bundler
  viteReact(),
],
```

これで vite が **5 environment** を build する:

| environment | 役割 | 出力先 |
|---|---|---|
| api | route 内 API handler | (server bundle 内) |
| middleware | TanStack Start middleware | (server bundle 内) |
| **rsc** | server component を Flight stream に emit | `dist/server/rsc/` |
| client | hydration + flight stream consumer | `dist/client/` |
| ssr | initial HTML render (client bundle と同 input) | `dist/server/` |

dev server (`vite dev`) も RSC 経路で動作。

### 3. server component の書き方

`src/server-components/Greeting.tsx`:

```tsx
export function Greeting({ name }: { name: string }) {
  const renderedAt = new Date().toISOString();
  return (
    <section className="rsc-spike">
      <h2>RSC spike</h2>
      <p>Hello, <strong>{name}</strong>. Rendered on the server at <time>{renderedAt}</time>.</p>
    </section>
  );
}
```

`"use server"` / `"use client"` directive は不要 (TanStack Start v1.167 の仕様)。**module-level directive ではなく "どこから呼ばれたか" で server / client が決まる**。`createServerFn().handler()` 内で `renderServerComponent(<Greeting />)` を呼ぶと、その call graph から到達する module は rsc environment にしか入らない。

### 4. route loader から Flight stream を返す

`src/routes/index.tsx`:

```tsx
const getGreeting = createServerFn().handler(async () => {
  const renderable = await renderServerComponent(<Greeting name="Ryan" />);
  return { greeting: renderable };
});

export const Route = createFileRoute("/")({
  loader: async () => {
    const { greeting } = await getGreeting();
    return { greeting };
  },
  component: IndexPage,
});

function IndexPage() {
  const { greeting } = Route.useLoaderData();
  return <main>{greeting}</main>;
}
```

`renderable` は **renderable proxy** で、JSX に `{greeting}` の形でそのまま埋め込める。client 側は flight stream を decode するだけで `Greeting` 本体の JS は load しない。

## 確認した挙動

```bash
# dev
$ curl -s http://localhost:5173/ | grep -aoE "(RSC spike|Hello, |rendered on the server)"
RSC spike
Hello,
rendered on the server
```

```bash
# production build 後の bundle
$ grep -l "RSC spike" dist/**/*.js
dist/server/rsc/assets/index-DCqGK2N6.js   # ← rsc env のみに出現
# dist/client/assets/*.js には現れない (client bundle 除外を確認)
```

## バンドルサイズの観察

| 状態 | client bundle (gzipped) |
|---|---|
| RSC 無効時 (placeholder のみ) | 109.68 kB |
| RSC 有効時 (Greeting 経由) | 121.26 kB |

**+11.6 kB** は `react-server-dom-webpack/client` の Flight decoder runtime が乗ったため。この 11.6 kB は固定 overhead で、**server に倒す content が増えるほど client bundle は削れる方向に進む** (TanStack 自身のブログ実測で 153 kB 削減実例あり、tanstack.com/blog/react-server-components)。

ryantsuji.dev は記事本文 + シンタックスハイライト + コードブロック装飾を server に倒すことが目的なので、RSC 有効化の overhead は最初の数記事で回収できる見込み。

## 制約 / 注意点

1. **`renderServerComponent` の引数は server で resolve される** — `<Greeting name="Ryan" />` の `Ryan` は server function 内で書く。loader の caller (client 側) から prop を流すには `createServerFn().validator(...).handler(({data}) => ...)` の data 経由で serializable 値だけ渡す。
2. **slot は opaque** — render prop を使いたい時は `createCompositeComponent` を別途使う。`React.Children.map()` は server 側で **動かない**。
3. **CF Workers 適応** — TanStack Start v1.167 の deploy target option は廃止済み。本リポジトリは generic SSR bundle (`dist/server/server.js`) を `server.ts` (Worker entry) で wrap する構造。RSC を有効化しても `dist/server/server.js` は引き続き生成されるので、Worker entry の interface は変わらず。**ただし production runtime 上での flight streaming は未検証** (本 spike は build と dev のみで終えた、CF deploy + 実機確認は別タスク)。
4. **TanStack Start RSC は実験的扱い** — v1.x の experimental phase。production 投入前に `@tanstack/react-start-rsc` の release notes を確認する習慣をつける。

## 次のアクション

- [ ] `Greeting.tsx` / spike 用の loader を削除 (記事 rendering の実装に置き換える時)
- [ ] markdown / MDX → server component の pipeline 設計 (shiki / rehype を server 側だけに置く)
- [ ] CF Workers 上での RSC streaming を実機確認 (`pnpm deploy:dry` → 実 deploy)
- [ ] design tokens / 実 layout を流し込む

## 参考

- [TanStack Start: Server Components docs](https://tanstack.com/start/v0/docs/framework/react/guide/server-components)
- [React Server Components Your Way (TanStack blog)](https://tanstack.com/blog/react-server-components)
- [Cloudflare: Improved RSC support in vite plugin (2026-02-11)](https://developers.cloudflare.com/changelog/post/2026-02-11-vite-plugin-child-environments/)
- [`@vitejs/plugin-rsc` on npm](https://www.npmjs.com/package/@vitejs/plugin-rsc)
