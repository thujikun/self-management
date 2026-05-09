/**
 * `createDb` factory の smoke test。
 *
 * 実 DB に繋がず、生成された client が Drizzle の expected interface (`select`,
 * `insert`, `update`, `delete`) を持つことだけ確認する。Neon HTTP を fetch ベースで
 * 叩く性質上、実 query は dev / prod で `pnpm drizzle:studio` 経由で確認する想定。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business createDb の factory contract 保証。実 fetch は走らせず、戻り object が Drizzle ORM の query builder method を持つことだけ確認する (実クエリは drizzle-kit studio / app 統合 test で扱う)
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import { createDb } from "./client.js";

describe("createDb", () => {
  it("Drizzle ORM client の query builder method を備える", () => {
    // Neon の DSN format に従っていれば fetch は走らない (lazy)。
    const db = createDb("postgresql://user:pass@host.neon.tech/db?sslmode=require");
    // Drizzle ORM の最小限期待 surface (公開 API として固定)。
    const required = ["select", "insert", "update", "delete", "transaction"] as const;
    const present = required.filter(
      (m) => typeof (db as unknown as Record<string, unknown>)[m] === "function",
    );
    expect(present).toStrictEqual([...required]);
  });
});
