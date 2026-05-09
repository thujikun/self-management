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

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  type Validator = (data: unknown) => unknown;
  type Handler = (args: { data: unknown }) => unknown;

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
          return await fn({ data });
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
