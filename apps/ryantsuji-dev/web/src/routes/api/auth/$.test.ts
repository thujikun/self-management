/**
 * `/api/auth/$` route の export shape + helper test。
 *
 * Route の `server.handlers` shape、`authHandler({ request, context })` が Response を返すこと
 * (実 OAuth fetch は走らない、Better Auth の generic 404 / 認証エラー Response を返すだけ) を確認する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business /api/auth/$ catch-all の Route shape + authHandler を網羅。context.env からの env binding 経路を fake env で踏み、実 OAuth は dev / browser E2E で扱う
 * @graph-connects none
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Env } from "../../../start.js";
import { Route, authHandler } from "./$.js";
import { _resetAuthCacheForTest } from "../../../server/auth.js";

const TEST_ENV: Env = {
  ASSETS: {} as Fetcher,
  DATABASE_URL: "postgresql://test:test@host.neon.tech/db?sslmode=require",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
  GITHUB_CLIENT_ID: "g",
  GITHUB_CLIENT_SECRET: "g",
  X_OAUTH2_CLIENT_ID: "x",
  X_OAUTH2_CLIENT_SECRET: "x",
};

describe("/api/auth/$ Route", () => {
  it("server.handlers に GET / POST が登録されている", () => {
    const handlers = Route.options.server?.handlers as Record<string, unknown> | undefined;
    expect(handlers && typeof handlers === "object").toBe(true);
    expect(Object.keys(handlers ?? {}).sort()).toStrictEqual(["GET", "POST"]);
  });
});

describe("authHandler", () => {
  beforeEach(() => _resetAuthCacheForTest());
  afterEach(() => _resetAuthCacheForTest());

  it("Request を受けて Response を返す (Better Auth runtime に委譲)", async () => {
    const req = new Request("http://localhost:3000/api/auth/session", { method: "GET" });
    const res = await authHandler({ request: req, context: { env: TEST_ENV } });
    expect(res).toBeInstanceOf(Response);
  });
});
