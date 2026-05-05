/**
 * `@self/otel` barrel export。
 *
 * 使い方:
 *   ```ts
 *   import { initOtel, createLogger, withSpan } from "@self/otel";
 *   await initOtel({ serviceName: "graph-migrate" });
 *   const log = createLogger("graph-migrate");
 *   await withSpan("step.parse", {}, () => parse());
 *   log.info({ rows: 27 }, "merged");
 *   ```
 *
 * @graph-stack ryan-product-graph
 * @graph-domain infra
 * @graph-business アプリ側に 1 行で OTel + structured logging を導入できるようにする barrel。secret / init / logger / span / pino-mixin を統合 export
 * @graph-connects none
 */

export { initOtel, shutdownOtel, buildBasicAuth, type OtelInitOptions } from "./init.js";
export { createLogger, type Logger } from "./logger.js";
export { withSpan } from "./span.js";
export { getSecret } from "./secret.js";
