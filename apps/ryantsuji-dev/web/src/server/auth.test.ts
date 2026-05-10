/**
 * `getAuth(env)` の smoke test。
 *
 * 実 OAuth provider に繋がず、生成された auth instance が Better Auth の
 * 期待 surface (`handler` / `api` / `$context` 系) を備えることだけ確認する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business getAuth が Better Auth instance を返す factory contract を保証。env の必須 7 keys を渡せば lazy に instance が組み立つことだけ確認、実 OAuth call は本番 / dev で確認する
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import { getAuth, type AuthEnv } from "./auth.js";

const TEST_ENV: AuthEnv = {
  DATABASE_URL: "postgresql://user:pass@host.neon.tech/db?sslmode=require",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
  GITHUB_CLIENT_ID: "test-gh-id",
  GITHUB_CLIENT_SECRET: "test-gh-secret",
  X_OAUTH2_CLIENT_ID: "test-x-id",
  X_OAUTH2_CLIENT_SECRET: "test-x-secret",
};

describe("getAuth", () => {
  it("env を渡すと Better Auth instance を返す (handler + api 系を備える)", () => {
    const auth = getAuth(TEST_ENV);
    const surface = ["handler", "api", "$context"] as const;
    const present = surface.filter((m) => m in auth);
    expect(present).toStrictEqual([...surface]);
  });

  it("呼ぶたびに別 instance を返す (per-request lazy)", () => {
    const a = getAuth(TEST_ENV);
    const b = getAuth(TEST_ENV);
    expect(a).not.toBe(b);
  });
});
