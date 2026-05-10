/**
 * `/api/auth/*` — Better Auth catch-all。
 *
 * Better Auth runtime が要求する全 endpoint (sign-in / sign-out / callback /
 * session / etc) を 1 つの handler で受ける。env binding は dev で `process.env`、
 * CF Workers production では将来 `event.context.cloudflare.env` 経由で渡す予定
 * (本 PR では process.env で統一、Workers 本番化は別 PR)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business `/api/auth/*` catch-all を Better Auth handler に委譲する route。env から secret/url/oauth credentials を読み出し、auth instance を per-request に組み立てて Request を流す
 * @graph-connects tanstack-start [provides] /api/auth/$ catch-all server handlers
 * @graph-connects better-auth [delegates_to] auth.handler(request) で全 auth endpoint を処理
 */

import { createFileRoute } from "@tanstack/react-router";

import { getAuth, type AuthEnv } from "../../../server/auth.js";

/**
 * `process.env` から `AuthEnv` を取り出す。CF Workers の env binding が入った時は
 * 本関数を `(event) => readEnv(event)` 形に拡張する。test から直接呼べるよう export。
 *
 * @graph-connects none
 */
export function readEnvFromProcess(env: NodeJS.ProcessEnv = process.env): AuthEnv {
  return {
    DATABASE_URL: env.DATABASE_URL ?? "",
    BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET ?? "",
    BETTER_AUTH_URL: env.BETTER_AUTH_URL ?? "http://localhost:3000",
    GITHUB_CLIENT_ID: env.GITHUB_CLIENT_ID ?? "",
    GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET ?? "",
    X_OAUTH2_CLIENT_ID: env.X_OAUTH2_CLIENT_ID ?? "",
    X_OAUTH2_CLIENT_SECRET: env.X_OAUTH2_CLIENT_SECRET ?? "",
  };
}

/**
 * Request を受けて Better Auth handler に流す薄い wrapper。test から直接呼べるよう export。
 *
 * @graph-connects better-auth [calls] auth.handler(request)
 */
export function authHandler({ request }: { request: Request }): Response | Promise<Response> {
  return getAuth(readEnvFromProcess()).handler(request);
}

/** @graph-connects tanstack-start [provides] /api/auth/$ catch-all */
export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: authHandler,
      POST: authHandler,
    },
  },
});
