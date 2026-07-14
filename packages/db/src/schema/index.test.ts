/**
 * Drizzle schema の構造保証 test。
 *
 * 実 DB に繋がず、table 定義の **shape** (table 名 / 列名 / 主キー / FK) を
 * Drizzle の `getTableConfig` 経由で抽出し inline snapshot で固定する。schema
 * の意図しない変更は migration 生成にも波及するので、ここで先に検知する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 各 table の name / columns / primary key / FK を inline snapshot で凍結し、schema drift を機械的に検知。実 DB に依存しないので CI でも flake せず実行できる
 * @graph-connects none
 */

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  account,
  comments,
  likes,
  posts,
  session,
  user,
  verification,
  viewCounts,
} from "./index.js";

function summarize(table: ReturnType<typeof getTableConfig>) {
  return {
    name: table.name,
    columns: table.columns
      .map((c) => ({
        name: c.name,
        notNull: c.notNull,
        primary: c.primary,
        hasDefault: c.hasDefault,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    primaryKeys: table.primaryKeys.map((pk) => pk.columns.map((c) => c.name).sort()),
    foreignKeys: table.foreignKeys.map((fk) => {
      const ref = fk.reference();
      const foreignConfig = getTableConfig(ref.foreignTable);
      return {
        columns: ref.columns.map((c) => c.name),
        foreignTable: foreignConfig.name,
        foreignColumns: ref.foreignColumns.map((c) => c.name),
        onDelete: fk.onDelete ?? null,
      };
    }),
  };
}

describe("posts schema", () => {
  it("構造を inline snapshot で固定", () => {
    expect(summarize(getTableConfig(posts))).toMatchInlineSnapshot(`
      {
        "columns": [
          {
            "hasDefault": true,
            "name": "first_seen_at",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "name": "published_at",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "name": "slug",
            "notNull": true,
            "primary": true,
          },
          {
            "hasDefault": false,
            "name": "title",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": true,
            "name": "updated_at",
            "notNull": true,
            "primary": false,
          },
        ],
        "foreignKeys": [],
        "name": "posts",
        "primaryKeys": [],
      }
    `);
  });
});

describe("comments schema", () => {
  it("構造を inline snapshot で固定 (cascade FK to posts)", () => {
    expect(summarize(getTableConfig(comments))).toMatchInlineSnapshot(`
      {
        "columns": [
          {
            "hasDefault": false,
            "name": "author_email",
            "notNull": false,
            "primary": false,
          },
          {
            "hasDefault": false,
            "name": "author_id",
            "notNull": false,
            "primary": false,
          },
          {
            "hasDefault": false,
            "name": "author_name",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "name": "author_profile_url",
            "notNull": false,
            "primary": false,
          },
          {
            "hasDefault": false,
            "name": "body",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": true,
            "name": "created_at",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "name": "deleted_at",
            "notNull": false,
            "primary": false,
          },
          {
            "hasDefault": true,
            "name": "id",
            "notNull": true,
            "primary": true,
          },
          {
            "hasDefault": false,
            "name": "parent_comment_id",
            "notNull": false,
            "primary": false,
          },
          {
            "hasDefault": false,
            "name": "post_slug",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": true,
            "name": "source",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "name": "source_comment_id",
            "notNull": false,
            "primary": false,
          },
          {
            "hasDefault": false,
            "name": "source_url",
            "notNull": false,
            "primary": false,
          },
          {
            "hasDefault": true,
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
        "name": "comments",
        "primaryKeys": [],
      }
    `);
  });
});

describe("likes schema", () => {
  it("構造を inline snapshot で固定 (composite PK + cascade FK)", () => {
    expect(summarize(getTableConfig(likes))).toMatchInlineSnapshot(`
      {
        "columns": [
          {
            "hasDefault": true,
            "name": "created_at",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "name": "identifier",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": true,
            "name": "kind",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
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
        "name": "likes",
        "primaryKeys": [
          [
            "identifier",
            "kind",
            "post_slug",
          ],
        ],
      }
    `);
  });
});

describe("viewCounts schema", () => {
  it("構造を inline snapshot で固定 (1:1 by post_slug PK + cascade FK)", () => {
    expect(summarize(getTableConfig(viewCounts))).toMatchInlineSnapshot(`
      {
        "columns": [
          {
            "hasDefault": true,
            "name": "count",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "name": "post_slug",
            "notNull": true,
            "primary": true,
          },
          {
            "hasDefault": true,
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
        "name": "view_counts",
        "primaryKeys": [],
      }
    `);
  });
});

describe("Better Auth schema", () => {
  it("user schema は Better Auth 標準に追従", () => {
    expect(summarize(getTableConfig(user))).toMatchInlineSnapshot(`
      {
        "columns": [
          {
            "hasDefault": false,
            "name": "created_at",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "name": "email",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "name": "email_verified",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "name": "id",
            "notNull": true,
            "primary": true,
          },
          {
            "hasDefault": false,
            "name": "image",
            "notNull": false,
            "primary": false,
          },
          {
            "hasDefault": false,
            "name": "name",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "name": "updated_at",
            "notNull": true,
            "primary": false,
          },
        ],
        "foreignKeys": [],
        "name": "user",
        "primaryKeys": [],
      }
    `);
  });

  it("session schema は user への cascade FK + token unique を持つ", () => {
    expect(summarize(getTableConfig(session))).toMatchInlineSnapshot(`
      {
        "columns": [
          {
            "hasDefault": false,
            "name": "created_at",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "name": "expires_at",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "name": "id",
            "notNull": true,
            "primary": true,
          },
          {
            "hasDefault": false,
            "name": "ip_address",
            "notNull": false,
            "primary": false,
          },
          {
            "hasDefault": false,
            "name": "token",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "name": "updated_at",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "name": "user_agent",
            "notNull": false,
            "primary": false,
          },
          {
            "hasDefault": false,
            "name": "user_id",
            "notNull": true,
            "primary": false,
          },
        ],
        "foreignKeys": [
          {
            "columns": [
              "user_id",
            ],
            "foreignColumns": [
              "id",
            ],
            "foreignTable": "user",
            "onDelete": "cascade",
          },
        ],
        "name": "session",
        "primaryKeys": [],
      }
    `);
  });

  it("account schema は OAuth provider linking 用 (cascade FK to user)", () => {
    expect(summarize(getTableConfig(account))).toMatchInlineSnapshot(`
      {
        "columns": [
          {
            "hasDefault": false,
            "name": "access_token",
            "notNull": false,
            "primary": false,
          },
          {
            "hasDefault": false,
            "name": "access_token_expires_at",
            "notNull": false,
            "primary": false,
          },
          {
            "hasDefault": false,
            "name": "account_id",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "name": "created_at",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "name": "id",
            "notNull": true,
            "primary": true,
          },
          {
            "hasDefault": false,
            "name": "id_token",
            "notNull": false,
            "primary": false,
          },
          {
            "hasDefault": false,
            "name": "password",
            "notNull": false,
            "primary": false,
          },
          {
            "hasDefault": false,
            "name": "provider_id",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "name": "refresh_token",
            "notNull": false,
            "primary": false,
          },
          {
            "hasDefault": false,
            "name": "refresh_token_expires_at",
            "notNull": false,
            "primary": false,
          },
          {
            "hasDefault": false,
            "name": "scope",
            "notNull": false,
            "primary": false,
          },
          {
            "hasDefault": false,
            "name": "updated_at",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "name": "user_id",
            "notNull": true,
            "primary": false,
          },
        ],
        "foreignKeys": [
          {
            "columns": [
              "user_id",
            ],
            "foreignColumns": [
              "id",
            ],
            "foreignTable": "user",
            "onDelete": "cascade",
          },
        ],
        "name": "account",
        "primaryKeys": [],
      }
    `);
  });

  it("verification schema は email/OTP token bag (FK なし)", () => {
    expect(summarize(getTableConfig(verification))).toMatchInlineSnapshot(`
      {
        "columns": [
          {
            "hasDefault": false,
            "name": "created_at",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "name": "expires_at",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "name": "id",
            "notNull": true,
            "primary": true,
          },
          {
            "hasDefault": false,
            "name": "identifier",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "name": "updated_at",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "name": "value",
            "notNull": true,
            "primary": false,
          },
        ],
        "foreignKeys": [],
        "name": "verification",
        "primaryKeys": [],
      }
    `);
  });
});
