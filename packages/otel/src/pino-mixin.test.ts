/**
 * `pino-mixin.ts` の unit test。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain infra
 * @graph-business createTraceMixin / pinoLevelToSeverity / createOtelDestination の動作網羅。OTel API は real instance を使い、span context 有無 / pino level → severity マップ / NDJSON パース失敗時の drop を検証
 * @graph-connects none
 */

import { context, trace } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import { InMemoryLogRecordExporter, LoggerProvider, SimpleLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-node";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createOtelDestination,
  createTraceMixin,
  pinoLevelToSeverity,
} from "./pino-mixin.js";

describe("pinoLevelToSeverity", () => {
  it.each([
    ["trace", SeverityNumber.TRACE],
    ["debug", SeverityNumber.DEBUG],
    ["info", SeverityNumber.INFO],
    ["warn", SeverityNumber.WARN],
    ["error", SeverityNumber.ERROR],
    ["fatal", SeverityNumber.FATAL],
    ["unknown", SeverityNumber.UNSPECIFIED],
  ])("%s → %d", (level, expected) => {
    expect(pinoLevelToSeverity(level)).toBe(expected);
  });
});

describe("createTraceMixin", () => {
  let traceProvider: BasicTracerProvider;

  beforeAll(() => {
    // context manager 無しだと `context.active()` から span が見えないので明示的に有効化
    context.setGlobalContextManager(new AsyncHooksContextManager().enable());
    traceProvider = new BasicTracerProvider();
    trace.setGlobalTracerProvider(traceProvider);
  });

  it("active span が無いとき → 空 record", () => {
    const mixin = createTraceMixin();
    expect(mixin()).toEqual({});
  });

  it("active span がある時 → trace_id / span_id / trace_flags を返す", () => {
    const tracer = traceProvider.getTracer("test");
    const result = tracer.startActiveSpan("op", (span) => {
      const out = createTraceMixin()();
      span.end();
      return out;
    });
    expect(result).toHaveProperty("trace_id");
    expect(result).toHaveProperty("span_id");
    expect(result).toHaveProperty("trace_flags");
    expect((result as Record<string, string>).trace_id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("invalid traceId (zeros) → 空 record", () => {
    // 直接 SpanContext を mock して `00000...` を返させる
    const fakeContext = trace.setSpan(context.active(), {
      spanContext: () => ({
        traceId: "00000000000000000000000000000000",
        spanId: "0000000000000000",
        traceFlags: 0,
      }),
      isRecording: () => false,
      setAttribute: () => fakeSpan,
      setAttributes: () => fakeSpan,
      addEvent: () => fakeSpan,
      addLink: () => fakeSpan,
      addLinks: () => fakeSpan,
      setStatus: () => fakeSpan,
      updateName: () => fakeSpan,
      end: () => undefined,
      recordException: () => undefined,
    } as unknown as ReturnType<typeof trace.getActiveSpan>);
    const fakeSpan = trace.getSpan(fakeContext);
    void fakeSpan;
    context.with(fakeContext, () => {
      expect(createTraceMixin()()).toEqual({});
    });
  });
});

describe("createOtelDestination", () => {
  let exporter: InMemoryLogRecordExporter;

  beforeAll(() => {
    exporter = new InMemoryLogRecordExporter();
    const provider = new LoggerProvider({
      processors: [new SimpleLogRecordProcessor(exporter)],
    });
    logs.setGlobalLoggerProvider(provider);
  });

  afterEach(() => {
    exporter.reset();
  });

  it("有効な NDJSON line を OTel LogRecord として emit", () => {
    const dest = createOtelDestination("svc");
    const result = dest.write(
      JSON.stringify({ level: "warn", message: "hi", foo: "bar", time: 1 }),
    );
    expect(result).toBe(true);
    const records = exporter.getFinishedLogRecords();
    expect(records).toHaveLength(1);
    expect(records[0].body).toBe("hi");
    expect(records[0].severityText).toBe("WARN");
    expect(records[0].severityNumber).toBe(SeverityNumber.WARN);
    expect(records[0].attributes).toMatchObject({ foo: "bar" });
    // `level` / `message` / `time` / `v` は attributes から除外されている
    expect(records[0].attributes).not.toHaveProperty("level");
    expect(records[0].attributes).not.toHaveProperty("message");
    expect(records[0].attributes).not.toHaveProperty("time");
  });

  it("level / message が無い行はデフォルト値で emit", () => {
    const dest = createOtelDestination("svc");
    dest.write("{}");
    const records = exporter.getFinishedLogRecords();
    expect(records).toHaveLength(1);
    expect(records[0].body).toBe("");
    expect(records[0].severityText).toBe("INFO");
  });

  it("不正な JSON は drop (例外を投げない、true 返却)", () => {
    const dest = createOtelDestination();
    expect(dest.write("not-a-json")).toBe(true);
    expect(exporter.getFinishedLogRecords()).toHaveLength(0);
  });
});
