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

import {
  buildTrackRow,
  getAccessToken,
  insertRows,
  parseSaJson,
  type TrackInput,
} from "../../server/bq-track.js";
import type { Env } from "../../start.js";

/**
 * `/api/track` の Hono context に渡る変数。Worker entry の `requestContext` から
 * env を取り出して per-request に bind する。
 *
 * @graph-connects none
 */
type TrackEnv = { Bindings: Env };

/**
 * Hono app instance — `/api` basepath。
 *
 * test と RPC client 両方から参照できるよう export している。
 *
 * @graph-connects hono [provides] /api/* に対する単一 Hono app instance
 */
export const app = new Hono<TrackEnv>()
  .basePath("/api")
  .get("/health", (c) =>
    c.json({
      status: "ok",
      service: "ryantsuji-dev-web",
      timestamp: new Date().toISOString(),
    }),
  )
  .post("/track", async (c) => {
    // analytics 経路は user response より優先度低いので、parse / sanitize / BQ insert
    // すべて fail-open で 204 を返し続ける。エラーは Worker logs / OTel span に出すだけ。
    try {
      const env = c.env;
      if (!env.GCP_SA_JSON || !env.BQ_PROJECT_ID) return c.body(null, 204);
      const sa = parseSaJson(env.GCP_SA_JSON);
      if (!sa) return c.body(null, 204);
      const input = (await c.req.json().catch(() => null)) as TrackInput | null;
      if (!input) return c.body(null, 204);
      const row = buildTrackRow(input, c.req.header("user-agent") ?? null);
      if (!row) return c.body(null, 204);
      const token = await getAccessToken(sa);
      await insertRows({
        token,
        projectId: env.BQ_PROJECT_ID,
        dataset: env.BQ_DATASET ?? "ryan",
        table: env.BQ_TABLE ?? "web_events",
        rows: [row],
      });
    } catch (err) {
      console.error("[/api/track] failed", err);
    }
    return c.body(null, 204);
  });

/**
 * Hono app の型を export して client 側 `hc<ApiType>()` で RPC 呼び出しに使う。
 *
 * @graph-connects hono [provides] RPC client type
 */
export type ApiType = typeof app;

/**
 * Hono app に `request` を渡して fetch する単一 handler。`context.env` を 2 引数で
 * 流すことで Hono の `c.env` 経由で Worker secret (`GCP_SA_JSON` 等) を読めるよう
 * にする。
 *
 * @graph-connects none
 */
const handler = ({ request, context }: { request: Request; context: { env: Env } }) =>
  app.fetch(request, context.env);

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
