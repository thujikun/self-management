/**
 * `@self/db` の barrel export 公開契約 test。
 *
 * `Object.keys(mod).sort()` を inline snapshot で固定し、export 名の追加削除を
 * 機械的に検知する。各 schema / client の挙動は専用 test に任せる。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business barrel export を inline snapshot で凍結し、公開 API の追加削除を検知。schema (posts/comments/likes/viewCounts) と client (createDb) を 1 entry から引ける契約を保証
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import * as mod from "./index.js";

describe("@self/db barrel exports", () => {
  it("公開 API を集約している", () => {
    expect(Object.keys(mod).sort()).toMatchInlineSnapshot(`
      [
        "comments",
        "createDb",
        "likes",
        "posts",
        "viewCounts",
      ]
    `);
  });
});
