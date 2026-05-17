/**
 * `/api/*` catch-all (Hono 委譲) のユニット test。
 *
 * TanStack Start の Route bundle を経由せず、export 済の Hono `app` instance を
 * 直接 `app.fetch(Request)` で叩いて handler を網羅する。Route export 自体も
 * オブジェクトとして実体化されることを確認することで、import の副作用ぶんだけは
 * coverage を稼ぐ (server.handlers の中身は TanStack Start 側でしか起動できないため
 * 単体では invoke せず、Hono 側 (`app`) を SSoT として網羅する)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business /api/* catch-all の handler 群を Hono app 経由で直接 fetch して網羅。CF Workers / TanStack Start runtime に依存せず unit test として完結し、ルーティングと response 形式の regression を取る
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import type { Env } from "../../start.js";
import { app, Route } from "./$.js";

/**
 * Hono handler は `context.env` を読むので、TanStack Start runtime 不在の test では
 * 最低限の Env shape (optional field のみ空 string で埋める) を fake binding として
 * 渡す。`/track` は `GCP_SA_JSON` 不在で 204 早期 return するため副作用 0。
 */
const FAKE_CONTEXT = {
  env: {
    ASSETS: {} as Fetcher,
    DATABASE_URL: "",
    BETTER_AUTH_SECRET: "",
    BETTER_AUTH_URL: "",
    GITHUB_CLIENT_ID: "",
    GITHUB_CLIENT_SECRET: "",
    X_OAUTH2_CLIENT_ID: "",
    X_OAUTH2_CLIENT_SECRET: "",
    GOOGLE_CLIENT_ID: "",
    GOOGLE_CLIENT_SECRET: "",
  } satisfies Env,
};

describe("/api/$ — Hono app", () => {
  it("GET /api/health は 200 + status:ok を返す", async () => {
    const res = await app.fetch(new Request("http://example.test/api/health"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);

    const data = (await res.json()) as { status: string; service: string; timestamp: string };
    expect(data.status).toBe("ok");
    expect(data.service).toBe("ryantsuji-dev-web");
    expect(typeof data.timestamp).toBe("string");
    expect(new Date(data.timestamp).getTime()).not.toBeNaN();
  });

  it("未定義の path は 404 を返す", async () => {
    const res = await app.fetch(new Request("http://example.test/api/nonexistent"));
    expect(res.status).toBe(404);
  });

  it("Route export は object として実体化されている", () => {
    expect(Route).toBeTypeOf("object");
    expect(Route).not.toBeNull();
  });

  it("Route.options.server.handlers.GET も同じ Hono response を返す", async () => {
    const opts = Route.options as {
      server?: {
        handlers?: Record<
          string,
          | ((ctx: { request: Request; context: { env: Env } }) => Promise<Response> | Response)
          | undefined
        >;
      };
    };
    const get = opts.server?.handlers?.GET;
    if (typeof get !== "function")
      throw new Error("Route.options.server.handlers.GET is not a function");

    const res = await get({
      request: new Request("http://example.test/api/health"),
      context: FAKE_CONTEXT,
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { status: string };
    expect(data.status).toBe("ok");
  });

  it("POST /api/track は GCP_SA_JSON 不在で 204 (fail-open)", async () => {
    const res = await app.fetch(
      new Request("http://example.test/api/track", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event_type: "page_view", path: "/" }),
      }),
      FAKE_CONTEXT.env,
    );
    expect(res.status).toBe(204);
  });
});
