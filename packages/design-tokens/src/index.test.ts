/**
 * `@self/design-tokens` の placeholder smoke test。
 *
 * Phase 1 (design discovery) で OKLCH 系 token + tokens.css 出力が入ったら、
 * primitive / semantic 各層に対する型と値の test に分割していく。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business `@self/design-tokens` の現状 stub に対する最低限の smoke test。Phase 1 実装後は本ファイルを削除して各 token domain (color / typography / motion 等) に test を分散する想定
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import { TOKEN_VERSION } from "./index.js";

describe("@self/design-tokens", () => {
  it("TOKEN_VERSION が文字列として export される", () => {
    expect(typeof TOKEN_VERSION).toBe("string");
    expect(TOKEN_VERSION.length).toBeGreaterThan(0);
  });
});
