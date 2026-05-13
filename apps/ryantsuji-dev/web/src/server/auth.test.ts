/**
 * `getAuth(env)` + `parseAllowedEmails(csv)` の smoke test。
 *
 * 実 OAuth provider に繋がず、生成された auth instance が Better Auth の
 * 期待 surface (`handler` / `api` / `$context` 系) を備えることと、AUTH_ALLOWED_EMAILS
 * の CSV → Set 正規化 (空 / whitespace / 大小無視) を確認する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business getAuth が Better Auth instance を返す factory contract と parseAllowedEmails の正規化を保証。env が空なら open (warn) / 値があれば Set として lock を効かせる挙動を test
 * @graph-connects none
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetAuthCacheForTest,
  assertSignUpAllowed,
  authCacheKey,
  buildAuth,
  getAuth,
  makeUserCreateBeforeHook,
  parseAllowedEmails,
  type AuthEnv,
} from "./auth.js";

const TEST_ENV: AuthEnv = {
  DATABASE_URL: "postgresql://user:pass@host.neon.tech/db?sslmode=require",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
  GITHUB_CLIENT_ID: "test-gh-id",
  GITHUB_CLIENT_SECRET: "test-gh-secret",
  X_OAUTH2_CLIENT_ID: "test-x-id",
  X_OAUTH2_CLIENT_SECRET: "test-x-secret",
  AUTH_ALLOWED_EMAILS: "ryan@example.com",
};

describe("parseAllowedEmails", () => {
  it("undefined → null (open mode)", () => {
    expect(parseAllowedEmails(undefined)).toBeNull();
  });

  it("空文字 / 空白のみ → null", () => {
    expect(parseAllowedEmails("")).toBeNull();
    expect(parseAllowedEmails("   ")).toBeNull();
    expect(parseAllowedEmails(",,, ")).toBeNull();
  });

  it("CSV を Set に正規化 (小文字化 / trim)", () => {
    const out = parseAllowedEmails(" Ryan@Example.com ,  hi@air-closet.com ");
    expect(out).toBeInstanceOf(Set);
    expect([...(out ?? [])].sort()).toStrictEqual(["hi@air-closet.com", "ryan@example.com"]);
  });
});

describe("buildAuth (pure factory、cache 非経由)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

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

  it("AUTH_ALLOWED_EMAILS が空なら open mode の warn を出す", () => {
    buildAuth({ ...TEST_ENV, AUTH_ALLOWED_EMAILS: "" });
    expect(warnSpy).toHaveBeenCalled();
    const message = String(warnSpy.mock.calls[0]?.[0] ?? "");
    expect(message).toMatch(/AUTH_ALLOWED_EMAILS is empty/);
  });

  it("AUTH_ALLOWED_EMAILS に値があれば warn を出さない", () => {
    buildAuth(TEST_ENV);
    expect(warnSpy).not.toHaveBeenCalled();
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

  it("AUTH_ALLOWED_EMAILS の有無で key が変わる (allowlist 変更を即反映)", () => {
    const a = authCacheKey({ ...TEST_ENV, AUTH_ALLOWED_EMAILS: "a@x" });
    const b = authCacheKey({ ...TEST_ENV, AUTH_ALLOWED_EMAILS: "b@x" });
    expect(a).not.toStrictEqual(b);
  });
});

describe("assertSignUpAllowed", () => {
  it("allowlist が null (open) → 何でも通す", () => {
    expect(() => assertSignUpAllowed(null, "anyone@example.com")).not.toThrow();
  });

  it("email が allowlist に含まれる → 通す", () => {
    const allowed = new Set(["ryan@example.com"]);
    expect(() => assertSignUpAllowed(allowed, "ryan@example.com")).not.toThrow();
  });

  it("email の大小無視で照合 (allowlist 側 / 入力側どちらの case でも)", () => {
    const allowed = new Set(["ryan@example.com"]);
    expect(() => assertSignUpAllowed(allowed, "Ryan@Example.com")).not.toThrow();
  });

  it("allowlist に無い email → APIError(FORBIDDEN) を throw", () => {
    const allowed = new Set(["ryan@example.com"]);
    expect(() => assertSignUpAllowed(allowed, "intruder@example.com")).toThrow(
      /sign-up is restricted/,
    );
  });
});

describe("makeUserCreateBeforeHook", () => {
  it("allowlist null → 受け取った data を { data } として返す", async () => {
    const hook = makeUserCreateBeforeHook(null);
    const data = { email: "anyone@example.com", name: "Anyone" };
    const out = await hook(data);
    expect(out).toStrictEqual({ data });
  });

  it("allowlist 内 email → { data } を返す", async () => {
    const hook = makeUserCreateBeforeHook(new Set(["ryan@example.com"]));
    const data = { email: "ryan@example.com", name: "Ryan" };
    const out = await hook(data);
    expect(out).toStrictEqual({ data });
  });

  it("allowlist 外 email → throw (assertSignUpAllowed 経由)", async () => {
    const hook = makeUserCreateBeforeHook(new Set(["ryan@example.com"]));
    await expect(hook({ email: "intruder@example.com", name: "X" })).rejects.toThrow(
      /sign-up is restricted/,
    );
  });
});
