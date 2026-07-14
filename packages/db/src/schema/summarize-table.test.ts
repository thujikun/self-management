/**
 * `summarize-table.ts` の test。
 *
 * 実 schema に存在しない branch (onDelete 無し FK / SQL 式 index / table 級 unique
 * 制約 / composite PK) も踏めるよう、synthetic な pgTable を test 内に定義して
 * 要約結果を inline snapshot で固定する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business summarizeTable の要約観点 (columns 整列 / FK onDelete fallback / index の列 vs SQL 式 / unique 制約 / composite PK) を synthetic table で網羅し、schema sibling test 群の共有 helper の回帰を取る
 * @graph-connects none
 */

import { sql } from "drizzle-orm";
import {
  getTableConfig,
  index,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { summarizeTable } from "./summarize-table.js";

const parent = pgTable("st_parent", {
  id: text("id").primaryKey(),
});

const child = pgTable(
  "st_child",
  {
    id: text("id").primaryKey(),
    parentId: text("parent_id")
      .notNull()
      .references(() => parent.id, { onDelete: "cascade" }),
    // onDelete を指定しない FK (summarize の `?? null` fallback を踏む)
    plainRef: text("plain_ref").references(() => parent.id),
    label: text("label").notNull().unique(),
  },
  (t) => [
    uniqueIndex("st_child_label_uq").on(t.label),
    // SQL 式 index (summarize の "<sql>" 表現を踏む)
    index("st_child_lower_label_idx").on(sql`lower(${t.label})`),
    unique("st_child_plain_uq").on(t.plainRef),
  ],
);

const pair = pgTable(
  "st_pair",
  {
    a: text("a").notNull(),
    b: text("b").notNull(),
  },
  (t) => [primaryKey({ columns: [t.a, t.b] })],
);

describe("summarizeTable", () => {
  it("FK / index / unique 制約を含む table を要約する", () => {
    expect(summarizeTable(getTableConfig(child))).toMatchInlineSnapshot(`
      {
        "columns": [
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "id",
            "notNull": true,
            "primary": true,
          },
          {
            "hasDefault": false,
            "isUnique": true,
            "name": "label",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "parent_id",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "plain_ref",
            "notNull": false,
            "primary": false,
          },
        ],
        "foreignKeys": [
          {
            "columns": [
              "parent_id",
            ],
            "foreignColumns": [
              "id",
            ],
            "foreignTable": "st_parent",
            "onDelete": "cascade",
          },
          {
            "columns": [
              "plain_ref",
            ],
            "foreignColumns": [
              "id",
            ],
            "foreignTable": "st_parent",
            "onDelete": "no action",
          },
        ],
        "indexes": [
          {
            "columns": [
              "label",
            ],
            "name": "st_child_label_uq",
            "unique": true,
          },
          {
            "columns": [
              "<sql>",
            ],
            "name": "st_child_lower_label_idx",
            "unique": false,
          },
        ],
        "name": "st_child",
        "primaryKeys": [],
        "uniqueConstraints": [
          {
            "columns": [
              "plain_ref",
            ],
            "name": "st_child_plain_uq",
          },
        ],
      }
    `);
  });

  it("composite PK を列名の配列で要約する", () => {
    expect(summarizeTable(getTableConfig(pair))).toMatchInlineSnapshot(`
      {
        "columns": [
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "a",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "b",
            "notNull": true,
            "primary": false,
          },
        ],
        "foreignKeys": [],
        "indexes": [],
        "name": "st_pair",
        "primaryKeys": [
          [
            "a",
            "b",
          ],
        ],
        "uniqueConstraints": [],
      }
    `);
  });
});
