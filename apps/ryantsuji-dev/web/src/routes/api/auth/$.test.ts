/**
 * `/api/auth/$` route の export shape + helper test。
 *
 * Route の `server.handlers` shape、`readEnvFromProcess` の env デフォルト挙動、
 * `authHandler({ request })` が Response を返すこと (実 OAuth fetch は走らない、
 * Better Auth の generic 404 / 認証エラー Response を返すだけ) を確認する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business /api/auth/$ catch-all の Route shape + readEnvFromProcess + authHandler を網羅。実 OAuth は dev / browser E2E で扱う
 * @graph-connects none
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Route, authHandler, readEnvFromProcess } from "./$.js";

describe("/api/auth/$ Route", () => {
  it("server.handlers に GET / POST が登録されている", () => {
    const handlers = Route.options.server?.handlers as Record<string, unknown> | undefined;
    expect(handlers && typeof handlers === "object").toBe(true);
    expect(Object.keys(handlers ?? {}).sort()).toStrictEqual(["GET", "POST"]);
  });
});

describe("readEnvFromProcess", () => {
  it("env が空でも shape を返す (URL は default、他は空文字、AUTH_ALLOWED_EMAILS は undefined)", () => {
    const out = readEnvFromProcess({});
    expect(out).toStrictEqual({
      DATABASE_URL: "",
      BETTER_AUTH_SECRET: "",
      BETTER_AUTH_URL: "http://localhost:3000",
      GITHUB_CLIENT_ID: "",
      GITHUB_CLIENT_SECRET: "",
      X_OAUTH2_CLIENT_ID: "",
      X_OAUTH2_CLIENT_SECRET: "",
      AUTH_ALLOWED_EMAILS: undefined,
    });
  });

  it("env に値があれば優先 (URL 含む)", () => {
    const out = readEnvFromProcess({
      DATABASE_URL: "postgresql://x",
      BETTER_AUTH_SECRET: "s".repeat(32),
      BETTER_AUTH_URL: "https://ryantsuji.dev",
      GITHUB_CLIENT_ID: "gh-id",
      GITHUB_CLIENT_SECRET: "gh-secret",
      X_OAUTH2_CLIENT_ID: "x-id",
      X_OAUTH2_CLIENT_SECRET: "x-secret",
    });
    expect(out.BETTER_AUTH_URL).toBe("https://ryantsuji.dev");
    expect(out.DATABASE_URL).toBe("postgresql://x");
  });
});

describe("authHandler", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    // 実 fetch は走らないが、Neon HTTP client は connection string の format
    // (postgresql:// を含む) だけは validate する。test 用の偽 URL を流して
    // factory 経由の組み立てまで進む経路を carve out する。
    process.env.DATABASE_URL = "postgresql://test:test@host.neon.tech/db?sslmode=require";
    process.env.BETTER_AUTH_SECRET = "x".repeat(32);
    process.env.GITHUB_CLIENT_ID = "g";
    process.env.GITHUB_CLIENT_SECRET = "g";
    process.env.X_OAUTH2_CLIENT_ID = "x";
    process.env.X_OAUTH2_CLIENT_SECRET = "x";
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("Request を受けて Response を返す (Better Auth runtime に委譲)", async () => {
    const req = new Request("http://localhost:3000/api/auth/session", { method: "GET" });
    const res = await authHandler({ request: req });
    expect(res).toBeInstanceOf(Response);
  });
});
