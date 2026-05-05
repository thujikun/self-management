/**
 * `init.ts` の unit test。
 *
 * 実 OTLP gateway を叩かず、config / 状態管理ロジックだけ検証する。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain infra
 * @graph-business initOtel の env-driven フローを網羅。OTEL_ENABLED=false の short-circuit、endpoint/instanceId 欠損時の no-op、buildBasicAuth の format、shutdown idempotency、再 init guard を検証
 * @graph-connects none
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _resetOtelForTest, buildBasicAuth, initOtel, shutdownOtel } from "./init.js";
import { _setSecretCacheForTest, clearSecretCache } from "./secret.js";

describe("buildBasicAuth", () => {
  it("`<id>:<token>` を base64 して `Basic ` を付ける", () => {
    const out = buildBasicAuth("123", "tok");
    // base64("123:tok") = "MTIzOnRvaw=="
    expect(out).toBe("Basic MTIzOnRvaw==");
  });

  it("token が空でも throw しない (Pulumi 介して空が来た場合の最低限の動作)", () => {
    expect(buildBasicAuth("123", "")).toBe("Basic MTIzOg==");
  });
});

describe("initOtel", () => {
  beforeEach(() => {
    _resetOtelForTest();
    clearSecretCache();
    delete process.env.OTEL_ENABLED;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.GRAFANA_OTLP_INSTANCE_ID;
    delete process.env.GRAFANA_OTLP_TOKEN_SECRET;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    // 実 OTLP 接続を避けるため start() を skip
    process.env.OTEL_SKIP_START = "true";
  });

  afterEach(async () => {
    await shutdownOtel();
    _resetOtelForTest();
    clearSecretCache();
    delete process.env.OTEL_SKIP_START;
  });

  it("OTEL_ENABLED=false → null を返して no-op", async () => {
    process.env.OTEL_ENABLED = "false";
    const sdk = await initOtel({ serviceName: "x" });
    expect(sdk).toBeNull();
  });

  it("endpoint も instanceId も無ければ null (ローカル開発 fallback)", async () => {
    const sdk = await initOtel({ serviceName: "x" });
    expect(sdk).toBeNull();
  });

  it("instanceId だけ無いと null (endpoint だけでは init しない)", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://example.test";
    const sdk = await initOtel({ serviceName: "x" });
    expect(sdk).toBeNull();
  });

  it("endpoint + instanceId + token (cache 注入) で起動 → SDK インスタンス返る", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://otlp.example.test";
    process.env.GRAFANA_OTLP_INSTANCE_ID = "999";
    process.env.GOOGLE_CLOUD_PROJECT = "proj";
    _setSecretCacheForTest("grafana-otlp-write-token", "tok-xxx", "proj");
    const sdk = await initOtel({
      serviceName: "x",
      enableAutoInstrumentation: false,
    });
    expect(sdk).not.toBeNull();
  });

  it("既に初期化済の状態で再 init すると同じ SDK を返す", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://otlp.example.test";
    process.env.GRAFANA_OTLP_INSTANCE_ID = "999";
    process.env.GOOGLE_CLOUD_PROJECT = "proj";
    _setSecretCacheForTest("grafana-otlp-write-token", "tok", "proj");
    const a = await initOtel({ serviceName: "x", enableAutoInstrumentation: false });
    const b = await initOtel({ serviceName: "x", enableAutoInstrumentation: false });
    expect(a).toBe(b);
  });

  it("opts で endpoint / instanceId / projectId / tokenSecretName を直渡しできる", async () => {
    _setSecretCacheForTest("custom-secret", "tok", "p2");
    const sdk = await initOtel({
      serviceName: "x",
      otlpEndpoint: "https://otlp.opt",
      instanceId: "1",
      projectId: "p2",
      tokenSecretName: "custom-secret",
      enableAutoInstrumentation: false,
    });
    expect(sdk).not.toBeNull();
  });

  it("shutdown 後に再 init 可能", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://otlp.example.test";
    process.env.GRAFANA_OTLP_INSTANCE_ID = "999";
    process.env.GOOGLE_CLOUD_PROJECT = "proj";
    _setSecretCacheForTest("grafana-otlp-write-token", "tok", "proj");
    const a = await initOtel({ serviceName: "x", enableAutoInstrumentation: false });
    expect(a).not.toBeNull();
    await shutdownOtel();
    const b = await initOtel({ serviceName: "x", enableAutoInstrumentation: false });
    expect(b).not.toBeNull();
    expect(b).not.toBe(a);
  });

  it("shutdown は init 前に呼んでも例外を投げない", async () => {
    await expect(shutdownOtel()).resolves.toBeUndefined();
  });
});
