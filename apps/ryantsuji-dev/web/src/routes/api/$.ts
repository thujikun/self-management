/**
 * `/api/*` catch-all — Hono に委譲する単一エントリ。
 *
 * TanStack Start v1.167 では server-side handlers は `createFileRoute(...).server({ handlers })`
 * の形式で定義する。この pattern で全 HTTP method を Hono `app.fetch` に流し込む。
 *
 * RPC の使い方:
 * ```ts
 * import { hc } from 'hono/client'
 * import type { ApiType } from '~/routes/api/$'
 * const client = hc<ApiType>('/')
 * const res = await client.api.health.$get()
 * ```
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business `/api/*` catch-all を Hono へ委譲し、TanStack Start の SSR worker と同居させる。Hono RPC の型を export することで client から型安全に API 呼び出せる構造を維持する
 * @graph-connects hono [delegates_to] /api/* の全 method を Hono の app.fetch に流し込む
 */

import { createFileRoute } from "@tanstack/react-router";
import { Hono } from "hono";

/**
 * Hono app instance — `/api` basepath。
 *
 * test と RPC client 両方から参照できるよう export している。
 *
 * @graph-connects hono [provides] /api/* に対する単一 Hono app instance
 */
export const app = new Hono().basePath("/api").get("/health", (c) =>
  c.json({
    status: "ok",
    service: "ryantsuji-dev-web",
    timestamp: new Date().toISOString(),
  }),
);

/**
 * Hono app の型を export して client 側 `hc<ApiType>()` で RPC 呼び出しに使う。
 *
 * @graph-connects hono [provides] RPC client type
 */
export type ApiType = typeof app;

/** @graph-connects none */
const handler = ({ request }: { request: Request }) => app.fetch(request);

/** @graph-connects tanstack-start [provides] /api/$ catch-all server handlers */
export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: handler,
      POST: handler,
      PUT: handler,
      PATCH: handler,
      DELETE: handler,
    },
  },
});
