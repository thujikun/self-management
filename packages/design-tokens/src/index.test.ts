/**
 * `@self/design-tokens` の barrel export 公開契約 test。
 *
 * testing.md の barrel pattern: `Object.keys(module).sort()` を inline snapshot で
 * 固定し、export 名の追加削除を変更検知する。各 module 個別の挙動は
 * primitive.test.ts / semantic.test.ts / css.test.ts で網羅。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business barrel export 経路の公開契約検証。Object.keys を inline snapshot で固定し、export 追加削除を機械的に検知する。中身は各 sub-module 専用 test に任せる
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import * as mod from "./index.js";

describe("@self/design-tokens barrel exports", () => {
  it("公開 API を集約している", () => {
    expect(Object.keys(mod).sort()).toMatchInlineSnapshot(`
      [
        "accent",
        "blur",
        "buildCss",
        "dark",
        "duration",
        "easing",
        "fontFamily",
        "fontSize",
        "fontWeight",
        "gray",
        "light",
        "lineHeight",
        "radius",
        "scaleToVars",
        "semanticToVars",
        "space",
      ]
    `);
  });
});
