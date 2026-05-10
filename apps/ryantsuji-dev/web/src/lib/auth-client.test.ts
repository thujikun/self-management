/**
 * `auth-client.ts` の barrel smoke test。
 *
 * 実 server に繋がず、export 名 (signIn / signOut / useSession + authClient) が
 * 揃っていることだけ確認。実挙動は browser での E2E で確認する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business auth-client の barrel export を inline snapshot で凍結し、Better Auth が期待する公開 API 名 (signIn/signOut/useSession + authClient) が揃っていることを保証
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import * as mod from "./auth-client.js";

describe("auth-client barrel", () => {
  it("signIn / signOut / useSession + authClient を export する", () => {
    expect(Object.keys(mod).sort()).toMatchInlineSnapshot(`
      [
        "authClient",
        "signIn",
        "signOut",
        "useSession",
      ]
    `);
  });
});
