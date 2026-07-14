/**
 * `likes` table の構造保証 test。
 *
 * 実 DB に繋がず、`getTableConfig` で shape を抽出し inline snapshot で固定する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business likes table (composite PK + cascade FK) の shape を inline snapshot で凍結し、like / reaction の unique 前提の drift を機械検知する
 * @graph-connects none
 */

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { likes } from "./likes.js";
import { summarizeTable } from "./summarize-table.js";

describe("likes schema", () => {
  it("構造を inline snapshot で固定 (composite PK + cascade FK)", () => {
    expect(summarizeTable(getTableConfig(likes))).toMatchInlineSnapshot(`
      {
        "columns": [
          {
            "hasDefault": true,
            "isUnique": false,
            "name": "created_at",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "identifier",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": true,
            "isUnique": false,
            "name": "kind",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "post_slug",
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
        "name": "likes",
        "primaryKeys": [
          [
            "identifier",
            "kind",
            "post_slug",
          ],
        ],
        "uniqueConstraints": [],
      }
    `);
  });
});
