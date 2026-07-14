/**
 * Better Auth core schema (`user` / `session` / `account` / `verification`) の構造保証 test。
 *
 * 実 DB に繋がず、`getTableConfig` で shape を抽出し inline snapshot で固定する。
 * Better Auth 標準への追従が SSoT なので、version bump 以外での drift をここで検知する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business Better Auth 4 table の shape を inline snapshot で凍結。table 名単数形 / camelCase 列 / cascade FK / token・email unique という Better Auth 標準前提の drift を機械検知する
 * @graph-connects none
 */

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { account, session, user, verification } from "./auth.js";
import { summarizeTable } from "./summarize-table.js";

describe("Better Auth schema", () => {
  it("user schema は Better Auth 標準に追従 (email unique)", () => {
    expect(summarizeTable(getTableConfig(user))).toMatchInlineSnapshot(`
      {
        "columns": [
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "created_at",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": true,
            "name": "email",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "email_verified",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "id",
            "notNull": true,
            "primary": true,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "image",
            "notNull": false,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "name",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "updated_at",
            "notNull": true,
            "primary": false,
          },
        ],
        "foreignKeys": [],
        "indexes": [],
        "name": "user",
        "primaryKeys": [],
        "uniqueConstraints": [],
      }
    `);
  });

  it("session schema は user への cascade FK + token unique を持つ", () => {
    expect(summarizeTable(getTableConfig(session))).toMatchInlineSnapshot(`
      {
        "columns": [
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "created_at",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "expires_at",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "id",
            "notNull": true,
            "primary": true,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "ip_address",
            "notNull": false,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": true,
            "name": "token",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "updated_at",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "user_agent",
            "notNull": false,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": false,
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
        "indexes": [],
        "name": "session",
        "primaryKeys": [],
        "uniqueConstraints": [],
      }
    `);
  });

  it("account schema は OAuth provider linking 用 (cascade FK to user)", () => {
    expect(summarizeTable(getTableConfig(account))).toMatchInlineSnapshot(`
      {
        "columns": [
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "access_token",
            "notNull": false,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "access_token_expires_at",
            "notNull": false,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "account_id",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "created_at",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "id",
            "notNull": true,
            "primary": true,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "id_token",
            "notNull": false,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "password",
            "notNull": false,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "provider_id",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "refresh_token",
            "notNull": false,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "refresh_token_expires_at",
            "notNull": false,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "scope",
            "notNull": false,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "updated_at",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": false,
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
        "indexes": [],
        "name": "account",
        "primaryKeys": [],
        "uniqueConstraints": [],
      }
    `);
  });

  it("verification schema は email/OTP token bag (FK なし)", () => {
    expect(summarizeTable(getTableConfig(verification))).toMatchInlineSnapshot(`
      {
        "columns": [
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "created_at",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "expires_at",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "id",
            "notNull": true,
            "primary": true,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "identifier",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "updated_at",
            "notNull": true,
            "primary": false,
          },
          {
            "hasDefault": false,
            "isUnique": false,
            "name": "value",
            "notNull": true,
            "primary": false,
          },
        ],
        "foreignKeys": [],
        "indexes": [],
        "name": "verification",
        "primaryKeys": [],
        "uniqueConstraints": [],
      }
    `);
  });
});
