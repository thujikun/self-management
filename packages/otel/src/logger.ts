/**
 * 構造化 logger (pino) の生成ファクトリ。
 *
 * `createLogger(serviceName)` で multistream pino logger を返す:
 * - stdout への JSON 出力 (Cloud Logging が拾う)
 * - OTLP destination 経由で Grafana Cloud Loki へ
 *
 * `OTEL_ENABLED=false` 環境では OTLP destination は付けない (ローカル開発)。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain infra
 * @graph-business 全アプリ共通の構造化 logger ファクトリ。pino + multistream で stdout と OTLP の両方に同時送信、trace context は mixin で全 log line に焼く
 * @graph-connects opentelemetry [calls] OTLP destination 経由で log を送出
 */

import pino from "pino";
import { createOtelDestination, createTraceMixin } from "./pino-mixin.js";

/**
 * 公開 Logger 型。pino の generics を裸で公開しないために最小 surface に絞る。
 */
export interface Logger {
  trace(msg: string, ...args: unknown[]): void;
  trace(obj: object, msg?: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
  debug(obj: object, msg?: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  info(obj: object, msg?: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  warn(obj: object, msg?: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  error(obj: object, msg?: string, ...args: unknown[]): void;
  fatal(msg: string, ...args: unknown[]): void;
  fatal(obj: object, msg?: string, ...args: unknown[]): void;
  child(bindings: Record<string, unknown>): Logger;
}

/** @graph-connects none */
function isOtelEnabled(): boolean {
  return process.env.OTEL_ENABLED !== "false";
}

/**
 * pino logger を作成。
 *
 * @param serviceName 全 log line に `service` field として付与される名前
 * @returns Logger 互換 instance
 *
 * @graph-connects opentelemetry [calls] OTLP destination 設定 (OTEL_ENABLED 時)
 */
export function createLogger(serviceName: string): Logger {
  const streams: Array<{ stream: NodeJS.WritableStream | { write: (c: string) => boolean } }> = [
    { stream: process.stdout },
  ];
  if (isOtelEnabled()) {
    streams.push({ stream: createOtelDestination(serviceName) });
  }

  return pino(
    {
      mixin: createTraceMixin(),
      formatters: {
        level: (label) => ({ severity: label.toUpperCase(), level: label }),
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      messageKey: "message",
      base: { service: serviceName },
    },
    pino.multistream(streams as Parameters<typeof pino.multistream>[0]),
  ) as unknown as Logger;
}
