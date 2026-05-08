/**
 * `@self/db` の placeholder 段階 smoke test。
 *
 * 後続 PR で Drizzle schema / migration / Neon client が入ったら、
 * 各モジュールの test ファイルに分割していく。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business `@self/db` の現状 stub に対する最低限の smoke test。schema 実装後は本ファイルを削除して各モジュール側に test を分散する想定
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import { DB_SCHEMA_VERSION } from "./index.js";

describe("@self/db", () => {
  it("DB_SCHEMA_VERSION が文字列として export される", () => {
    expect(typeof DB_SCHEMA_VERSION).toBe("string");
    expect(DB_SCHEMA_VERSION.length).toBeGreaterThan(0);
  });
});
