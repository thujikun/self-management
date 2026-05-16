/**
 * `getAuth(env)` / `buildAuth(env)` / `authCacheKey(env)` の smoke test。
 *
 * 実 OAuth provider に繋がず、生成された auth instance が Better Auth の期待 surface
 * (`handler` / `api` / `$context`) を備えること、isolate cache の hit/miss/reset の挙動、
 * cache key が credential 変更で変わることを確認する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business getAuth が Better Auth instance を返す factory contract と isolate cache (globalThis Symbol-keyed) の動作を保証。sign-up open 方針なので allowlist 系の gate は無く、build に必要な env binding contract のみ test
 * @graph-connects none
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { _resetAuthCacheForTest, authCacheKey, buildAuth, getAuth, type AuthEnv } from "./auth.js";

const TEST_ENV: AuthEnv = {
  DATABASE_URL: "postgresql://user:pass@host.neon.tech/db?sslmode=require",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
  GITHUB_CLIENT_ID: "test-gh-id",
  GITHUB_CLIENT_SECRET: "test-gh-secret",
  X_OAUTH2_CLIENT_ID: "test-x-id",
  X_OAUTH2_CLIENT_SECRET: "test-x-secret",
  GOOGLE_CLIENT_ID: "test-google-id",
  GOOGLE_CLIENT_SECRET: "test-google-secret",
};

describe("buildAuth (pure factory、cache 非経由)", () => {
  it("env を渡すと Better Auth instance を返す (handler + api 系を備える)", () => {
    const auth = buildAuth(TEST_ENV);
    const surface = ["handler", "api", "$context"] as const;
    const present = surface.filter((m) => m in auth);
    expect(present).toStrictEqual([...surface]);
  });

  it("呼ぶたびに別 instance を返す (cache 無し、per-request lazy)", () => {
    const a = buildAuth(TEST_ENV);
    const b = buildAuth(TEST_ENV);
    expect(a).not.toBe(b);
  });
});

describe("getAuth (isolate cache 経由)", () => {
  beforeEach(() => _resetAuthCacheForTest());
  afterEach(() => _resetAuthCacheForTest());

  it("同 env で 2 回呼ぶと同 instance を返す (cache hit)", () => {
    const a = getAuth(TEST_ENV);
    const b = getAuth(TEST_ENV);
    expect(a).toBe(b);
  });

  it("env が変わると別 instance を返す (cache miss + 差し替え)", () => {
    const a = getAuth(TEST_ENV);
    const b = getAuth({ ...TEST_ENV, BETTER_AUTH_SECRET: "y".repeat(32) });
    expect(a).not.toBe(b);
  });

  it("_resetAuthCacheForTest で cache がクリアされる", () => {
    const a = getAuth(TEST_ENV);
    _resetAuthCacheForTest();
    const b = getAuth(TEST_ENV);
    expect(a).not.toBe(b);
  });
});

describe("authCacheKey", () => {
  it("同 env なら同 key", () => {
    expect(authCacheKey(TEST_ENV)).toStrictEqual(authCacheKey(TEST_ENV));
  });

  it("BETTER_AUTH_SECRET が変わると key が変わる", () => {
    const a = authCacheKey(TEST_ENV);
    const b = authCacheKey({ ...TEST_ENV, BETTER_AUTH_SECRET: "z".repeat(32) });
    expect(a).not.toStrictEqual(b);
  });

  it("GITHUB_CLIENT_ID が変わると key が変わる", () => {
    const a = authCacheKey(TEST_ENV);
    const b = authCacheKey({ ...TEST_ENV, GITHUB_CLIENT_ID: "other" });
    expect(a).not.toStrictEqual(b);
  });
});
