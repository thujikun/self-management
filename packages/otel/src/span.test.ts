/**
 * `span.ts` の unit test。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain infra
 * @graph-business withSpan の正常 / 例外パスを SDK の InMemorySpanExporter で検証。span name / attributes / status / 例外記録 が期待通りに記録されること、関数の戻り値がそのまま返ることを保証
 * @graph-connects none
 */

import { trace, SpanStatusCode } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { withSpan } from "./span.js";

let exporter: InMemorySpanExporter;

beforeAll(() => {
  exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(provider);
});

afterEach(() => {
  exporter.reset();
});

describe("withSpan", () => {
  it("関数の戻り値をそのまま返す + span に attributes を付ける", async () => {
    const out = await withSpan("op", { kind: "test" }, () => 42);
    expect(out).toBe(42);
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("op");
    expect(spans[0].attributes).toMatchObject({ kind: "test" });
    expect(spans[0].status.code).toBe(SpanStatusCode.OK);
  });

  it("Promise を返す関数も await して値を返す", async () => {
    const out = await withSpan("async-op", {}, async () => {
      await new Promise((r) => setTimeout(r, 1));
      return "done";
    });
    expect(out).toBe("done");
    expect(exporter.getFinishedSpans()[0].name).toBe("async-op");
  });

  it("例外が投げられたら span に ERROR status + recordException + 再 throw", async () => {
    await expect(
      withSpan("fail", {}, () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].status.code).toBe(SpanStatusCode.ERROR);
    expect(spans[0].status.message).toBe("boom");
    expect(spans[0].events.some((e) => e.name === "exception")).toBe(true);
  });

  it("非 Error 値が throw されても message を string 化して再 throw", async () => {
    await expect(
      withSpan("fail", {}, () => {
        // 意図的に non-Error 値を throw して string 化パスを通す
        const thrown: unknown = "raw-string";
        throw thrown;
      }),
    ).rejects.toBe("raw-string");
    const spans = exporter.getFinishedSpans();
    expect(spans[0].status.code).toBe(SpanStatusCode.ERROR);
    expect(spans[0].status.message).toBe("raw-string");
    // recordException は Error instance のみなので events なし
    expect(spans[0].events.some((e) => e.name === "exception")).toBe(false);
  });

  it("tracerName を指定可能", async () => {
    await withSpan("named", {}, () => undefined, "custom-tracer");
    const spans = exporter.getFinishedSpans();
    expect(spans[0].instrumentationScope.name).toBe("custom-tracer");
  });
});
