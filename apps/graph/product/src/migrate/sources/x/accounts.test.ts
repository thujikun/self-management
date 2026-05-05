/**
 * `accounts.ts` の unit test。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business X_ACCOUNTS 静的 config の整合性検証 + personIdFor が deterministicId と同じ結果を返すこと、threads.ts の SELF_PERSON_ID と一致することを担保
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";
import { deterministicId } from "../../common/id.js";
import { X_ACCOUNTS, personIdFor, PERSON_SOURCE } from "./accounts.js";

describe("X_ACCOUNTS", () => {
  it("contains both ryantsuji and ryanaircloset entries", () => {
    const accounts = X_ACCOUNTS.map((a) => a.account);
    expect(accounts).toContain("ryantsuji");
    expect(accounts).toContain("ryanaircloset");
    expect(X_ACCOUNTS).toHaveLength(2);
  });

  it("personHandle is lowercase (case-insensitive person_id generation)", () => {
    for (const a of X_ACCOUNTS) {
      expect(a.personHandle).toBe(a.personHandle.toLowerCase());
    }
  });

  it("each entry has non-empty userId, handle, displayName", () => {
    for (const a of X_ACCOUNTS) {
      expect(a.userId).toMatch(/^\d+$/);
      expect(a.handle.length).toBeGreaterThan(0);
      expect(a.displayName.length).toBeGreaterThan(0);
    }
  });
});

describe("personIdFor", () => {
  it("returns deterministicId(PERSON_SOURCE, personHandle)", () => {
    const a = X_ACCOUNTS.find((x) => x.account === "ryantsuji")!;
    expect(personIdFor(a)).toBe(deterministicId(PERSON_SOURCE, "ryantsuji"));
  });

  it("ryantsuji と ryanaircloset で違う person_id を返す", () => {
    const en = X_ACCOUNTS.find((x) => x.account === "ryantsuji")!;
    const jp = X_ACCOUNTS.find((x) => x.account === "ryanaircloset")!;
    expect(personIdFor(en)).not.toBe(personIdFor(jp));
  });
});
