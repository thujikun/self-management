/**
 * OpenTelemetry SDK 初期化。
 *
 * アプリケーションの entry point で **最初に** 1 回だけ呼ぶ:
 *   ```ts
 *   import { initOtel } from "@self/otel";
 *   await initOtel({ serviceName: "graph-migrate" });
 *   ```
 *
 * 環境変数:
 * - `OTEL_ENABLED=false` で全体無効化 (ローカル / test 用)
 * - `OTEL_EXPORTER_OTLP_ENDPOINT`: 例 `https://otlp-gateway-prod-ap-northeast-0.grafana.net`
 * - `GOOGLE_CLOUD_PROJECT`: Secret Manager のプロジェクト ID
 * - `GRAFANA_OTLP_TOKEN_SECRET` (default `grafana-otlp-write-token`): token を持つ secret 名
 * - `GRAFANA_OTLP_INSTANCE_ID`: Basic auth の username (Pulumi の `grafanaStackId` 出力値)
 *
 * @graph-stack ryan-product-graph
 * @graph-domain infra
 * @graph-business OTel Node SDK の起動。Grafana Cloud OTLP 用 Basic auth header を Secret Manager から組み立て、Trace/Metrics/Logs 全シグナルの exporter を仕込む
 * @graph-connects grafana-cloud [writes_to] OTLP gateway へ telemetry を送信
 */

import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { logs } from "@opentelemetry/api-logs";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { getSecret } from "./secret.js";

export interface OtelInitOptions {
  serviceName: string;
  serviceVersion?: string;
  environment?: string;
  /** OTLP gateway URL。省略時は `OTEL_EXPORTER_OTLP_ENDPOINT` env */
  otlpEndpoint?: string;
  /** Grafana Cloud instance ID (Basic auth username)。省略時は `GRAFANA_OTLP_INSTANCE_ID` env */
  instanceId?: string;
  /** Secret Manager の token secret 名。省略時は env or default */
  tokenSecretName?: string;
  /** GCP project ID。省略時は env */
  projectId?: string;
  enableAutoInstrumentation?: boolean;
}

/** @graph-connects none */
let sdk: NodeSDK | null = null;
/** @graph-connects none */
let loggerProvider: LoggerProvider | null = null;

/**
 * Basic auth header 値を組み立てる: `Basic <base64(instanceId:token)>`。
 *
 * @graph-connects none
 */
export function buildBasicAuth(instanceId: string, token: string): string {
  const raw = `${instanceId}:${token}`;
  const b64 = Buffer.from(raw, "utf8").toString("base64");
  return `Basic ${b64}`;
}

/**
 * OTel SDK を起動。重複 init は no-op。`OTEL_ENABLED=false` で skip。
 *
 * @graph-connects grafana-cloud [writes_to] traces/metrics/logs OTLP exporter 起動
 */
export async function initOtel(opts: OtelInitOptions): Promise<NodeSDK | null> {
  if (process.env.OTEL_ENABLED === "false") return null;
  if (sdk) return sdk;

  const otlpEndpoint = opts.otlpEndpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const instanceId = opts.instanceId ?? process.env.GRAFANA_OTLP_INSTANCE_ID;
  const tokenSecret =
    opts.tokenSecretName ??
    process.env.GRAFANA_OTLP_TOKEN_SECRET ??
    "grafana-otlp-write-token";

  if (!otlpEndpoint || !instanceId) {
    // endpoint / instance ID 未設定はローカル開発と判断、no-op
    return null;
  }

  const token = await getSecret(tokenSecret, opts.projectId);
  const headers = { Authorization: buildBasicAuth(instanceId, token) };

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: opts.serviceName,
    [ATTR_SERVICE_VERSION]: opts.serviceVersion ?? process.env.K_REVISION ?? "dev",
    "deployment.environment": opts.environment ?? process.env.ENVIRONMENT ?? "development",
  });

  const traceExporter = new OTLPTraceExporter({ url: `${otlpEndpoint}/v1/traces`, headers });
  const metricExporter = new OTLPMetricExporter({ url: `${otlpEndpoint}/v1/metrics`, headers });
  const logExporter = new OTLPLogExporter({ url: `${otlpEndpoint}/v1/logs`, headers });

  // Logs は SDK ではなく LoggerProvider を直接組み立てる (pino destination からも使うため)
  loggerProvider = new LoggerProvider({
    resource,
    processors: [new BatchLogRecordProcessor(logExporter)],
  });
  logs.setGlobalLoggerProvider(loggerProvider);

  sdk = new NodeSDK({
    resource,
    traceExporter,
    metricReader: new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 15000,
    }),
    instrumentations: opts.enableAutoInstrumentation === false ? [] : [getNodeAutoInstrumentations()],
  });

  // テスト環境では実 OTLP 接続を避けるため `OTEL_SKIP_START=true` で `start()` 抑止。
  // 本番では未設定 = false 扱いで通常通り start。
  if (process.env.OTEL_SKIP_START !== "true") {
    sdk.start();
  }
  return sdk;
}

/**
 * graceful shutdown。テスト / プロセス終了時に呼ぶ。
 *
 * @graph-connects grafana-cloud [writes_to] バッファ flush
 */
export async function shutdownOtel(): Promise<void> {
  await loggerProvider?.shutdown();
  await sdk?.shutdown();
  loggerProvider = null;
  sdk = null;
}

/**
 * テスト用: 内部状態をリセットして再 init を許す。
 *
 * @graph-connects none
 */
export function _resetOtelForTest(): void {
  loggerProvider = null;
  sdk = null;
}
