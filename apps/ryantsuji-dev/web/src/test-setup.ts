/**
 * vitest 用の app 固有 setup。
 *
 * `createServerFn` は production runtime では client → HTTP RPC → server handler
 * の経路で動くが、vitest test 環境にはその runtime がない。テストでは route loader
 * から server fn を呼ぶ統合テストを書きたいので、`createServerFn` を **handler を
 * 即時実行する passthrough** に置き換える。
 *
 * 物理的な bundle 分離は build 側 (`@vitejs/plugin-rsc` の AST 変換) が担うので、
 * テストで passthrough にしても production の挙動には影響しない。
 *
 * 本ファイルは `apps/ryantsuji-dev/web/vitest.config.ts` の `setupFiles` から
 * のみ参照される (root vitest config からは見えない)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business vitest 用に createServerFn を passthrough mock し、route loader 経由の統合テストを成立させる。bundle 分離 (rsc env vs client) は @vitejs/plugin-rsc の build-time 変換が担うのでテストには影響しない
 * @graph-connects none
 */

import { vi } from "vitest";

/**
 * test 用に注入する **fake Env binding** (CF Workers の `context.env` shape)。
 * `createServerFn` passthrough mock が handler に渡す context.env をここで定義し、
 * env 経路 (`context.env.DATABASE_URL` 等) を踏む統合 test を成立させる。
 *
 * @graph-connects none
 */
export const TEST_FAKE_ENV = {
  ASSETS: {} as unknown,
  DATABASE_URL: "postgresql://test:test@host.neon.tech/db?sslmode=require",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
  GITHUB_CLIENT_ID: "g",
  GITHUB_CLIENT_SECRET: "g",
  X_OAUTH2_CLIENT_ID: "x",
  X_OAUTH2_CLIENT_SECRET: "x",
  GOOGLE_CLIENT_ID: "google",
  GOOGLE_CLIENT_SECRET: "google",
} as const;

/**
 * happy-dom は `navigator.sendBeacon` を polyfill しない (Node 自体も持たない) ので、
 * `lib/track-client.ts` の page_view beacon が必ず fetch fallback 経路に流れて
 * `http://localhost:3000/api/track` を本物の network connect しに行き、ECONNREFUSED
 * で unhandled rejection が出る。test ではこれを no-op true に stub して fetch
 * フォールバックを抑止する。`track-client.test.ts` 側は test 内で本物の stub を
 * `originalSendBeacon` として捕まえ直して mock を per-case に注入し直すため、
 * 本 stub が test の網羅性を奪うことはない。
 */
if (typeof navigator !== "undefined") {
  Object.defineProperty(navigator, "sendBeacon", {
    value: () => true,
    configurable: true,
    writable: true,
  });
}

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  type Validator = (data: unknown) => unknown;
  type Handler = (args: { data: unknown; context: unknown }) => unknown;

  function createMock() {
    let validator: Validator | null = null;
    const builder = {
      inputValidator(v: Validator) {
        validator = v;
        return builder;
      },
      handler(fn: Handler) {
        return async (args: { data: unknown } = { data: undefined }) => {
          const data = validator ? validator(args.data) : args.data;
          // production では Worker が (req, env, ctx) を context に詰めるが、test では
          // TEST_FAKE_ENV を fake binding として handler に渡し、env 経路を踏む。
          return await fn({ data, context: { env: TEST_FAKE_ENV, ctx: {} } });
        };
      },
    };
    return builder;
  }

  return {
    ...actual,
    createServerFn: (() => createMock()) as unknown as typeof actual.createServerFn,
  };
});
