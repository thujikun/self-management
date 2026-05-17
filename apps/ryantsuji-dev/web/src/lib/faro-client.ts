/**
 * Grafana Faro (Web SDK) の client-side 初期化 helper。
 *
 * `__root.tsx` の useEffect から呼ばれ、`VITE_FARO_COLLECTOR_URL` (build 時に
 * `import.meta.env` で確定) を見て collector URL に対し RUM event (page load /
 * web-vital / unhandled error / unhandled rejection / fetch tracing 等) を送る。
 *
 * 本ファイルは **必ず lazy import で読み込まれる** (= `import('./faro-client.js')`
 * を useEffect 内で呼ぶ前提)。Faro SDK は window / document 等の DOM API を eager
 * import 直後に触るため、SSR 経路で eager 読み込みすると `ReferenceError: window
 * is not defined` で SSR 全体が落ちる。lazy import + client only での実行で完全
 * 隔離する。
 *
 * 初期化前に collector URL が空なら no-op。これにより `wrangler secret put` 未実施
 * stage / preview deploy 等で URL が空のまま build されても runtime error にはならない
 * (= fail-open 設計、server.ts の OTLP 経路と同じ思想)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business client-side RUM (Real User Monitoring)。Grafana Faro 経由で page load timing / web-vital / unhandled error 等を集約。collector URL は build 時に固定 (VITE_FARO_COLLECTOR_URL)、未設定なら init 自体を skip して fail-open
 * @graph-connects grafana-cloud [writes_to] Grafana Cloud Frontend Observability (Faro) collector に RUM event を送出
 */

import { initializeFaro, getWebInstrumentations } from "@grafana/faro-web-sdk";

/**
 * Faro init guard。複数回呼ばれても 2 回目以降は no-op (HMR / strict-mode の
 * 二重 useEffect 対策)。module-level closure で 1 度だけ true になる。
 *
 * @graph-connects none
 */
let initialized = false;

/**
 * Faro を 1 回だけ初期化する。URL が空文字 / undefined / 既に initialized なら no-op。
 *
 * `app.name` / `app.environment` は Faro 側 UI / query で filter する際の key になる。
 * `version` は package.json と手動同期 (release tag に合わせたい時は別途 build var で
 * inject する想定だが、本 PR では未対応)。
 *
 * @graph-connects grafana-cloud [calls] initializeFaro(url, app, instrumentations)
 */
export function initFaro(collectorUrl: string | undefined): boolean {
  if (initialized) return false;
  if (!collectorUrl) return false;
  initializeFaro({
    url: collectorUrl,
    app: {
      name: "ryantsuji-dev-web",
      version: "0.1.0",
      environment: detectEnvironment(),
    },
    instrumentations: [...getWebInstrumentations()],
  });
  initialized = true;
  return true;
}

/**
 * hostname から environment label (`production` / `preview` / `development`) を決める。
 *
 * - `ryantsuji.dev` / `www.ryantsuji.dev` → production
 * - `*.ryantsuji-dev-web.workers.dev` / preview deploy → preview
 * - それ以外 (localhost 等) → development
 *
 * @graph-connects none
 */
export function detectEnvironment(): "production" | "preview" | "development" {
  if (typeof window === "undefined") return "development";
  const host = window.location.hostname;
  if (host === "ryantsuji.dev" || host === "www.ryantsuji.dev") return "production";
  if (host.endsWith(".workers.dev")) return "preview";
  return "development";
}

/**
 * 単体 test 用の reset 関数。`initialized` flag を倒す。本 module は module-level
 * mutable state を持つので test 間で reset しないと「2 回目以降の test は init を
 * skip して assertion が常に通る (false positive)」になる。
 *
 * @graph-connects none
 */
export function _resetFaroInitForTest(): void {
  initialized = false;
}
