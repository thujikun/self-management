/**
 * `@self/og-image` の barrel re-export 健全性テスト。公開 API surface を
 * 1 箇所で固定する (誤って export を絞ったり広げたりした時にここで気付く)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business og-image package の公開 surface を inline snapshot で固定。新規 export 追加時はここを更新する明示的 gate になる
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import * as mod from "./index.js";

describe("@self/og-image barrel", () => {
  it("renderOgImage を export する", () => {
    expect(typeof mod.renderOgImage).toBe("function");
  });

  it("公開 export keys snapshot", () => {
    expect(Object.keys(mod).sort()).toStrictEqual(["renderOgImage"]);
  });
});
