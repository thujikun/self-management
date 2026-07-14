/**
 * `view_counts` table の構造保証 test。
 *
 * 実 DB に繋がず、`getTableConfig` で shape を抽出し inline snapshot で固定する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business view_counts table (posts と 1:1 の counter) の shape を inline snapshot で凍結し、increment 経路が依存する PK / FK の drift を機械検知する
 * @graph-connects none
 */

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { summarizeTable } from "./summarize-table.js";
import { viewCounts } from "./view-counts.js";

describe("viewCounts schema", () => {
  it("構造を inline snapshot で固定 (1:1 by post_slug PK + cascade FK)", () => {
    expect(summarizeTable(getTableConfig(viewCounts))).toMatchInlineSnapshot(`
      {
        "columns": [
          {
            "hasDefault": true,
            "isUnique": false,
            "name": "count",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "post_slug",
            "notNull": true,
            "primary": true,
          },
          {
            "hasDefault": true,
            "isUnique": false,
            "name": "updated_at",
            "notNull": true,
            "primary": false,
          },
        ],
        "foreignKeys": [
          {
            "columns": [
              "post_slug",
            ],
            "foreignColumns": [
              "slug",
            ],
            "foreignTable": "posts",
            "onDelete": "cascade",
          },
        ],
        "indexes": [],
        "name": "view_counts",
        "primaryKeys": [],
        "uniqueConstraints": [],
      }
    `);
  });
});
