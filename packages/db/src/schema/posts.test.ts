/**
 * `posts` table の構造保証 test。
 *
 * 実 DB に繋がず、`getTableConfig` で shape を抽出し inline snapshot で固定する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business posts table (slug PK の投稿 identity) の shape を inline snapshot で凍結し、FK target としての drift を機械検知する
 * @graph-connects none
 */

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { posts } from "./posts.js";
import { summarizeTable } from "./summarize-table.js";

describe("posts schema", () => {
  it("構造を inline snapshot で固定 (slug PK)", () => {
    expect(summarizeTable(getTableConfig(posts))).toMatchInlineSnapshot(`
      {
        "columns": [
          {
            "hasDefault": true,
            "isUnique": false,
            "name": "first_seen_at",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "published_at",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "slug",
            "notNull": true,
            "primary": true,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "title",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": true,
            "isUnique": false,
            "name": "updated_at",
            "notNull": true,
            "primary": false,
          },
        ],
        "foreignKeys": [],
        "indexes": [],
        "name": "posts",
        "primaryKeys": [],
        "uniqueConstraints": [],
      }
    `);
  });
});
