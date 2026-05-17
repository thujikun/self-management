/**
 * Pino logger 用の OTel 統合ヘルパー。
 *
 * - `createTraceMixin()`: 現在の span context (trace_id / span_id / trace_flags) を
 *   全 log line に焼き込む pino mixin。これで Loki 上で trace と log がリンクする。
 * - `createOtelDestination()`: pino multistream の destination として使うと、
 *   各 log line を OTel LoggerProvider 経由で OTLP へ送る。
 *
 * Loki 側の attribute 命名は self-management 用に簡略化 (severity / message / trace_id / span_id のみ)。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain infra
 * @graph-business pino から OTLP に流すための 2 つのフック (mixin / destination)。trace と log を 1 つの context に紐付ける役目
 * @graph-connects opentelemetry [calls] active span context を取得 / LoggerProvider に emit
 */

import { trace, context } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import type { AnyValue, AnyValueMap } from "@opentelemetry/api-logs";

/**
 * 現在の active span から trace context を抽出する pino mixin。
 *
 * span が無いとき (sampling 外、init 前) は trace 情報を出さない。
 *
 * @graph-connects opentelemetry [calls] trace.getActiveSpan で span context 取得
 */
export function createTraceMixin(): () => Record<string, unknown> {
  return () => {
    const span = trace.getSpan(context.active());
    if (!span) return {};
    const ctx = span.spanContext();
    if (!ctx.traceId || ctx.traceId === "00000000000000000000000000000000") return {};
    return {
      trace_id: ctx.traceId,
      span_id: ctx.spanId,
      trace_flags: ctx.traceFlags,
    };
  };
}

/**
 * pino level (string) を OTel SeverityNumber にマップ。
 *
 * pino のデフォルト level: trace / debug / info / warn / error / fatal。
 *
 * @graph-connects none
 */
export function pinoLevelToSeverity(level: string): SeverityNumber {
  switch (level) {
    case "trace":
      return SeverityNumber.TRACE;
    case "debug":
      return SeverityNumber.DEBUG;
    case "info":
      return SeverityNumber.INFO;
    case "warn":
      return SeverityNumber.WARN;
    case "error":
      return SeverityNumber.ERROR;
    case "fatal":
      return SeverityNumber.FATAL;
    default:
      return SeverityNumber.UNSPECIFIED;
  }
}

/**
 * pino multistream に渡せる destination を返す。
 *
 * pino の各 log line (NDJSON) を parse → OTel LoggerProvider に LogRecord として emit。
 * `initOtel()` で LoggerProvider をグローバル登録してある前提。
 *
 * destination は `write(chunk: string): boolean` を実装した object。pino はこれに
 * NDJSON line を渡してくる。
 *
 * @graph-connects opentelemetry [calls] logs.getLogger().emit で OTLP に送信
 */
export function createOtelDestination(loggerName = "self-management"): {
  write: (chunk: string) => boolean;
} {
  const logger = logs.getLogger(loggerName);
  return {
    write(chunk: string): boolean {
      try {
        const obj: Record<string, unknown> = JSON.parse(chunk);
        const level = typeof obj.level === "string" ? obj.level : "info";
        const message = typeof obj.message === "string" ? obj.message : "";
        const severity = pinoLevelToSeverity(level);
        // JSON.parse の返り値は AnyValue (scalar / array / nested map / null) と互換。
        // TS は recursive subset を証明できないので value 単位で AnyValue にキャスト。
        const attrs: AnyValueMap = {};
        for (const [k, v] of Object.entries(obj)) {
          if (k === "message" || k === "level" || k === "time" || k === "v") continue;
          attrs[k] = v as AnyValue;
        }
        logger.emit({
          severityText: level.toUpperCase(),
          severityNumber: severity,
          body: message,
          attributes: attrs,
        });
      } catch {
        // parse 失敗は黙って drop (stdout にはそのまま出てる)
      }
      return true;
    },
  };
}
