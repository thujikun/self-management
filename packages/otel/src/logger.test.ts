/**
 * `logger.ts` の unit test。
 *
 * pino の出力を stdout 経由で stream にピックアップし、JSON line として検証する。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain infra
 * @graph-business createLogger が pino logger を返し、service field 付き JSON 行を出すことを smoke 検証。OTLP destination の有無は OTEL_ENABLED=false で skip 経路もテスト
 * @graph-connects none
 */

import { Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("createLogger", () => {
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  let captured: string[];

  beforeEach(() => {
    captured = [];
    // process.stdout.write を hijack して payload を capture
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      captured.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = originalStdoutWrite;
    delete process.env.OTEL_ENABLED;
    vi.resetModules();
  });

  it("OTEL_ENABLED=false のとき stdout だけに出る", async () => {
    process.env.OTEL_ENABLED = "false";
    const { createLogger } = await import("./logger.js");
    const log = createLogger("test-svc");
    log.info({ x: 1 }, "hello");
    // pino はバッファリングするので少し待つ
    await new Promise((r) => setTimeout(r, 10));
    const joined = captured.join("");
    expect(joined).toContain("hello");
    expect(joined).toContain("test-svc");
    const line = joined
      .split("\n")
      .find((l) => l.includes("hello"));
    expect(line).toBeDefined();
    const parsed = JSON.parse(line!);
    expect(parsed.service).toBe("test-svc");
    expect(parsed.message).toBe("hello");
    expect(parsed.x).toBe(1);
    expect(parsed.severity).toBe("INFO");
  });

  it("child logger は親の base bindings を引き継ぐ", async () => {
    process.env.OTEL_ENABLED = "false";
    const { createLogger } = await import("./logger.js");
    const log = createLogger("svc").child({ requestId: "abc" });
    log.info("child msg");
    await new Promise((r) => setTimeout(r, 10));
    const line = captured
      .join("")
      .split("\n")
      .find((l) => l.includes("child msg"));
    expect(line).toBeDefined();
    const parsed = JSON.parse(line!);
    expect(parsed.requestId).toBe("abc");
    expect(parsed.service).toBe("svc");
  });

  it("OTEL_ENABLED 未設定でも logger は生成できる (destination 例外が漏れない)", async () => {
    delete process.env.OTEL_ENABLED;
    const { createLogger } = await import("./logger.js");
    const log = createLogger("default-svc");
    expect(typeof log.info).toBe("function");
    log.info("ok");
  });

  it("error / warn / debug / fatal level も呼べる", async () => {
    process.env.OTEL_ENABLED = "false";
    const { createLogger } = await import("./logger.js");
    const log = createLogger("svc");
    // pino の info logger では debug は無視される (level=info default)。
    // 各 level の method が存在すれば OK。
    expect(() => log.error("e")).not.toThrow();
    expect(() => log.warn("w")).not.toThrow();
    expect(() => log.debug("d")).not.toThrow();
    expect(() => log.trace("t")).not.toThrow();
    expect(() => log.fatal("f")).not.toThrow();
  });
});

// 型 export だけの smoke test (型は dts に出るだけ)
describe("Logger type", () => {
  it("Writable が import 可能 (環境健全性チェック)", () => {
    expect(typeof Writable).toBe("function");
  });
});
