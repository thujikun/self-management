/**
 * `@self/content` の barrel export 公開契約 test。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business barrel export を inline snapshot で固定し、公開 API の追加削除を機械的に検知する
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import * as mod from "./index.js";

describe("@self/content barrel exports", () => {
  it("公開 API を集約している", () => {
    expect(Object.keys(mod).sort()).toMatchInlineSnapshot(`
      [
        "FrontmatterSchema",
        "estimateReadingTimeMinutes",
        "extractHeadings",
        "parseFrontmatter",
        "renderMarkdown",
        "slugify",
      ]
    `);
  });
});
