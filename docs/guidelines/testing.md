# テスト品質

cortex の `docs/guidelines/testing.md` を、self-management の vitest 構成 (90% per-file threshold + ts-morph cold-start に備えた `testTimeout: 15000`) に合わせて適用する。

## 基本原則

### テストは実装詳細ではなく振る舞いを検証する

private メソッドの呼び出し回数や内部データ構造の形を固定すると、仕様が変わっていないリファクタリングでも落ちやすい。戻り値、状態変化、副作用、公開 API の契約など、外部から観測できる結果を検証する。

判断基準:
- リファクタリングで落ちるなら壊れやすい
- バグ混入時に落ちるなら価値が高い

### テストポートフォリオは階層で設計する

Test Pyramid を前提に、細かいテストは多く、重いテストは少なく保つ。

- **Small / Unit**: 速い、局所的、大量
- **Medium / Integration**: 接続面と契約を検証 (例: TanStack Router + RouterProvider + renderToString)
- **Large / E2E**: 主要導線だけを少数に絞る (例: ryantsuji.dev の deploy + curl 確認)

### flaky を許容しない

「再実行したら通る」はテストの成功ではなく、信頼性低下のシグナルである。赤を信じられない状態になると、CI もレビューも機能しなくなる。

flaky の根本原因 (時間依存 / 乱数 / 共有状態 / 並列負荷下の cold-start / ネットワーク) を直す。retry / `skip` / `quarantine` で隠さない。

ts-morph cold-start のような並列負荷下でのみ発生する flake は、`vitest.config.ts` の `testTimeout` を上げるなど **設定で吸収できる範囲なら設定で**、そうでないものは **prewarm / warmup hook** で対処する。

### カバレッジは目的ではなく補助指標

見るべきは数値そのものではなく、重要な業務ルールが守られているか、失敗時に原因を追えるか、変更時の誤検知が少ないかである。

ただし、**self-management は per-file 90% threshold (statements / branches / functions / lines 全部) を機械強制している** (`vitest.config.ts`)。これは「最初から整えないと運用できない」という Ryan ルールに基づく。閾値を下げる変更は **Critical** で禁止 (CLAUDE.md と整合)。閾値が満たせない時は **テストを足す or 構造で解く**。`exclude` 追加で逃げない。

## テスト設計

### まず失敗モードから考える

実装前に次を明確にする:
1. 何が壊れるとユーザーや業務が困るか
2. その壊れ方をどの層で最も安く検知できるか
3. 1 つの不具合をどの層で 1 回だけ捕まえるか

### AAA または Given / When / Then で統一する

全テストを同じ構造で書く。

- Given / Arrange: 前提データ
- When / Act: 実行
- Then / Assert: 期待結果

### 1 テスト 1 意図に絞る

異なる仕様を 1 つのテストに混ぜると、失敗時に何が壊れたのか分からない。テスト名は仕様文として読める形にし、assertion はその仕様を補強する範囲に限定する。

### `index.ts` / barrel テストは機械的に固定する

`index.ts` が単なる re-export の集約点である場合、テストの目的は「何が公開されているか」を安価に固定することにある。

基本方針:
- `import * as module from './index.js'` で runtime export を一括取得
- `Object.keys(module).sort()` を `toMatchInlineSnapshot()` で固定
- snapshot は export 名の公開契約として扱う
- 型 export は runtime に現れないため、型テスト側で検証

```ts
import { describe, expect, it } from 'vitest';
import * as mod from './index.js';

describe('barrel exports', () => {
  it('公開 API を集約している', () => {
    expect(Object.keys(mod).sort()).toMatchInlineSnapshot(`
      [
        "createRouter",
        "getRouter",
      ]
    `);
  });
});
```

## レイヤー別ガイド

### Unit (Small)

純粋関数、ドメインロジック、変換処理を最優先で対象化。空 / 最小 / 最大 / 異常値などの入力境界を明示。clock / random / UUID は注入可能にして決定的に。

避けること:
- フレームワーク内部仕様の再テスト
- モック過多で実装詳細しか検証しないテスト

### Integration (Medium)

接続面を検証。例:
- TanStack Router + RouterProvider + `renderToString` で SSR 結果に landing コピーが含まれる (`apps/ryantsuji-dev/web/src/routes/__root.test.tsx` パターン)
- Hono `app.fetch(Request)` で response 形状を直接検証 (`apps/ryantsuji-dev/web/src/routes/api/$.test.ts` パターン)
- Pulumi `runtime.setMocks` で `getZoneOutput` を mock し、export を検証 (`infra/ryantsuji-dev/index.test.ts` パターン)

外部 I/O 以外はできるだけ本物を使う。

### E2E (Large)

主要導線のみ。例: deploy 後に `curl https://ryantsuji.dev/` で 200 + landing コピー確認。ケースを増やしすぎない。

## モック / スタブの方針

妥当な対象:
- 外部 SaaS API (X / Zenn / dev.to / CF / Vertex AI / OpenAI)
- 課金・メール送信など副作用が重い処理
- 低速な外部システム

守ってはいけないもの:
- 実装内部の呼び出し回数だけを検証するテスト
- request / response schema を無視したダミー契約

## flaky を防ぐルール

- 時間依存を固定する (fake timer、固定 clock)
- 乱数 seed を固定する
- 共有状態を持たない
- 外部ネットワーク依存を切る
- `sleep` で待たず、条件成立を監視する
- 並列実行前提で衝突しない ID / 資源を使う

## 弱い Vitest matcher を避ける

「とりあえず通る assertion」でカバレッジだけ稼ぐのを防ぐため、次の matcher は **原則避ける**:

- `toBeTruthy` / `toBeFalsy`
- `toBeDefined` / `toBeUndefined`
- `toBe(true|false)` / `toEqual(true|false)` / `toStrictEqual(true|false)`
- `toContain` / `toContainEqual`
- `expect.any` / `expect.anything` / `expect.objectContaining`
- `toBeTypeOf`

最優先で使うべきは、期待値をオブジェクト全体で固定する **`toStrictEqual`**。部分一致や存在確認だけで済ませず、仕様として意味のある出力全体を比較する。

`expect(result.hoge)` のようなプロパティ単位のテストは、意図しない変化が他のプロパティに入っていても検知できない。基本は `expect(result).toStrictEqual(...)` の形で、戻り値や出力全体の不変性を検証する。

ただし、テスト対象が大きく `toStrictEqual` の期待値を手で維持しづらい場合は、`toMatchInlineSnapshot` / `toMatchSnapshot` を使って出力全体の変化を検知してよい。そのうえで業務上重要なプロパティだけを補助的に個別 assertion するのは許容される。

代わりに使う具体的な matcher:
- `toStrictEqual` ← 最優先
- `toMatchInlineSnapshot` / `toMatchSnapshot`
- `toHaveLength`
- `toMatchObject` (部分一致が意図された場合に限る)
- `toThrow` / `toThrowErrorMatchingInlineSnapshot`
- `toMatch` (string regex)

> **NOTE**: 既存テスト (本ガイドライン制定前のもの) には弱い matcher が残っている可能性がある。新規テスト追加時はこのルールに従い、既存テスト改修時は強い matcher への移行を併せて行う。

## レビュー時のチェック観点

### テストの存在

- [ ] 新規コードにテストが書かれているか (実装と同じディレクトリに `*.test.ts` / `*.test.tsx` を配置)
- [ ] per-file 90% (statements / branches / functions / lines 全部) を満たしているか
- [ ] re-export のみの `index.ts` にもテストファイルがあるか (vitest pre-commit で 0% チェックに引っかかる)
- [ ] 自動生成ファイル (`routeTree.gen.ts` 等) が `vitest.config.ts` の `coverage.exclude` に明記されているか — 「stub だから / framework boilerplate だから」を理由に exclude 追加するのは禁止 (Critical)

### テストの品質

- [ ] AAA / Given-When-Then で意図が読める構造か
- [ ] 実装詳細ではなく外部から観測できる振る舞いを検証しているか
- [ ] モックは最小限か (過度なモックは実装詳細への結合)
- [ ] 正常系だけでなく境界値・エラーケースがカバーされているか
- [ ] テスト名が期待される動作を明確に記述しているか
- [ ] flaky 要因 (時間 / 乱数 / 共有状態 / 順序依存) がないか
- [ ] 弱い matcher で重要 assertion を済ませていないか (上の禁止リスト参照)

### エラーハンドリング

- [ ] `catch` ブロックが空になっていないか — 必ずログ出力
- [ ] エラーメッセージが具体的かつ実用的か

### ファイルサイズ・構造

- [ ] 1 ファイルのコード行が 500 行以下か (CLAUDE.md rule 4)。**ただしテストファイル (`*.test.*` / `*.spec.*`) は cap 対象外** — inline snapshot で網羅すると行が自然に伸びるため。
- [ ] 関数の引数が 3 つ以下か (超える場合はオブジェクト引数)
- [ ] 早期リターンパターンでネストが浅いか

### 命名・スタイル

- [ ] ESLint ルール (`eslint.config.js`) に準拠しているか — `pnpm lint --max-warnings=0` 通過必須
- [ ] ファイル名: kebab-case、定数: UPPER_SNAKE_CASE、ブール値: `is` / `has` / `should` プレフィックス
- [ ] コメントは日本語 (グローバル CLAUDE.md と整合)

## flaky 既知パターン

| 症状 | 根本原因 | 対処 |
|------|----------|------|
| `parser.test.ts` が full-suite 実行時に 5s timeout、isolation では 1.4s で pass | ts-morph in-memory project の cold-start が並列負荷下で遅延 | `vitest.config.ts` の `testTimeout: 15000` で吸収 (実装済) |
| 並列で同じ BQ table を書き込むテストで race | 共有状態 / 並列実行衝突 | unique table prefix + cleanup hook |
| 時刻依存 assertion (`new Date().getTime() < threshold` 等) が稀に fail | 実時間に依存 | fake timer (`vi.useFakeTimers`) + 固定 clock |
