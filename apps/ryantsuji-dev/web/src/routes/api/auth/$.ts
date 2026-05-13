/**
 * `/api/auth/*` — Better Auth catch-all。
 *
 * Better Auth runtime が要求する全 endpoint (sign-in / sign-out / callback / session / etc)
 * を 1 つの handler で受ける。env binding は **`context.env`** から取得 (`src/server.ts` が
 * `(req, env, ctx)` を `requestContext` に詰める)。`process.env` 経路は廃止。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business `/api/auth/*` catch-all を Better Auth handler に委譲する route。CF Workers の env binding を context.env から型付きで読み出し、auth instance (isolate cache 経由) に request を流す
 * @graph-connects tanstack-start [provides] /api/auth/$ catch-all server handlers
 * @graph-connects better-auth [delegates_to] auth.handler(request) で全 auth endpoint を処理
 */

import { createFileRoute } from "@tanstack/react-router";

import type { Env } from "../../../start.js";
import { getAuth } from "../../../server/auth.js";

/**
 * Better Auth handler 入口。`context.env` から auth credential / DB URL を取り出して
 * `getAuth(env).handler(request)` に flow。test から直接呼べるよう env を引数で受ける形に export。
 *
 * @graph-connects better-auth [calls] auth.handler(request)
 */
export function authHandler({
  request,
  context,
}: {
  request: Request;
  context: { env: Env };
}): Response | Promise<Response> {
  return getAuth(context.env).handler(request);
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
