/**
 * `comments` table の構造保証 test。
 *
 * 実 DB に繋がず、`getTableConfig` で shape (table 名 / 列 / PK / FK / index) を
 * 抽出し inline snapshot で固定する。特に devto 取り込みの冪等キー
 * `comments_source_id_uq` unique index は import 経路 (`onConflictDoUpdate`) の
 * 前提なので、落ちたらここで検知する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business comments table の name / columns / PK / FK / unique index を inline snapshot で凍結し、devto 取り込みの冪等 upsert が依存する schema shape の drift を機械検知する
 * @graph-connects none
 */

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { comments } from "./comments.js";
import { summarizeTable } from "./summarize-table.js";

describe("comments schema", () => {
  it("構造を inline snapshot で固定 (cascade FK to posts + 冪等 unique index)", () => {
    expect(summarizeTable(getTableConfig(comments))).toMatchInlineSnapshot(`
      {
        "columns": [
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "author_email",
            "notNull": false,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "author_id",
            "notNull": false,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "author_name",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "author_profile_url",
            "notNull": false,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "body",
            "notNull": true,
            "primary": false,
          },
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
            "name": "deleted_at",
            "notNull": false,
            "primary": false,
          },
          {
            "hasDefault": true,
            "isUnique": false,
            "name": "id",
            "notNull": true,
            "primary": true,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "parent_comment_id",
            "notNull": false,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "post_slug",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": true,
            "isUnique": false,
            "name": "source",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "source_comment_id",
            "notNull": false,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "source_url",
            "notNull": false,
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
          {
            "columns": [
              "parent_comment_id",
            ],
            "foreignColumns": [
              "id",
            ],
            "foreignTable": "comments",
            "onDelete": "cascade",
          },
        ],
        "indexes": [
          {
            "columns": [
              "source",
              "source_comment_id",
            ],
            "name": "comments_source_id_uq",
            "unique": true,
          },
        ],
        "name": "comments",
        "primaryKeys": [],
        "uniqueConstraints": [],
      }
    `);
  });

  it("devto 取り込みの冪等キー (source, source_comment_id) unique index を持つ", () => {
    const cfg = getTableConfig(comments);
    expect(
      cfg.indexes.map((i) => ({
        name: i.config.name,
        unique: i.config.unique,
        columns: i.config.columns.map((c) => ("name" in c ? c.name : "")),
      })),
    ).toStrictEqual([
      { name: "comments_source_id_uq", unique: true, columns: ["source", "source_comment_id"] },
    ]);
  });
});
