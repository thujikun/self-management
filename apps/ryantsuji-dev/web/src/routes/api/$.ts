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
 * @graph-business `/api/*` catch-all を Hono へ委譲し、TanStack Start の SSR worker と同居させる。Hono RPC の型を export することで client から型安全に API 呼び出せる構造を維持する。`/api/track` は fail-open で 204 を返しつつ、失敗経路は OTel active span に `track.bq.fail` event + ERROR status を残し、fail-silent と区別できるようにする
 * @graph-connects hono [delegates_to] /api/* の全 method を Hono の app.fetch に流し込む
 * @graph-connects grafana-cloud [writes_to] /api/track 失敗時に active span に `track.bq.fail` event を addEvent (OTel API)
 */

import { trace, SpanStatusCode, type Span } from "@opentelemetry/api";
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
 * 与えられた span に `track.bq.fail` event + ERROR status を載せる pure helper。
 * span が null/undefined なら no-op。caller は active span を取り出して渡す。
 *
 * 本体を分離することで、`trace.getActiveSpan()` を直接 mock せずに fake span を
 * 渡すだけで全 branch (err instanceof Error / そうでない) を unit test できる。
 *
 * @graph-connects grafana-cloud [writes_to] 引数 span に track.bq.fail event を addEvent
 */
export function recordTrackFailureOn(span: Span | undefined, reason: string, err?: unknown): void {
  if (!span) return;
  const attrs: Record<string, string> = { reason };
  if (err instanceof Error) {
    attrs["error.name"] = err.name;
    attrs["error.message"] = err.message;
  }
  span.addEvent("track.bq.fail", attrs);
  span.setStatus({ code: SpanStatusCode.ERROR, message: `track.bq.fail:${reason}` });
}

/**
 * `/api/track` の fail-open 経路で「sink まで届かなかった理由」を OTel に残すための
 * 入口。`@microlabs/otel-cf-workers` の `instrument()` が incoming fetch を span 化
 * するので、その active span を取り出して `recordTrackFailureOn` に流す。
 *
 * これで「broken SA / 期限切れ key / BQ quota over / wrong project ID」のような
 * 異常が、204 を返しても Tempo 側で「track.bq.fail」span event として可観測になる。
 *
 * @graph-connects grafana-cloud [writes_to] active span に track.bq.fail event を addEvent
 */
function recordTrackFailure(reason: string, err?: unknown): void {
  recordTrackFailureOn(trace.getActiveSpan(), reason, err);
}

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
    // すべて fail-open で 204 を返し続ける。fail 経路は OTel active span に
    // `track.bq.fail` event + status=ERROR で残し、fail-silent と区別できる形にする。
    const env = c.env;
    if (!env.GCP_SA_JSON || !env.BQ_PROJECT_ID) return c.body(null, 204);
    const sa = parseSaJson(env.GCP_SA_JSON);
    if (!sa) {
      recordTrackFailure("parse-sa-json");
      return c.body(null, 204);
    }
    const input = (await c.req.json().catch(() => null)) as TrackInput | null;
    if (!input) {
      recordTrackFailure("parse-input");
      return c.body(null, 204);
    }
    const row = buildTrackRow(input, c.req.header("user-agent") ?? null);
    if (!row) {
      recordTrackFailure("build-row");
      return c.body(null, 204);
    }
    try {
      const token = await getAccessToken(sa);
      await insertRows({
        token,
        projectId: env.BQ_PROJECT_ID,
        dataset: env.BQ_DATASET ?? "ryan",
        table: env.BQ_TABLE ?? "web_events",
        rows: [row],
      });
    } catch (err) {
      recordTrackFailure("oauth-or-insert", err);
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
