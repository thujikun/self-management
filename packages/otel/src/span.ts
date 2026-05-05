/**
 * 同期/非同期処理を span でラップする小さなヘルパー。
 *
 * try/catch を 3 行書かなくても span 開始 → エラー記録 → 終了が 1 行で書ける:
 *   ```ts
 *   const rows = await withSpan("bq.merge", { table: "persons" }, () => mergeRows("persons", inputs));
 *   ```
 *
 * @graph-stack ryan-product-graph
 * @graph-domain infra
 * @graph-business アプリコードに span lifecycle を点在させない (start/end/setStatus/recordException) ため、関数を span でラップする最小ヘルパー。同期/非同期どちらにも対応
 * @graph-connects opentelemetry [calls] tracer.startActiveSpan で span 起動
 */

import { SpanStatusCode, trace, type Attributes } from "@opentelemetry/api";

/**
 * `name` の span を起動して `fn` を実行。fn 内の例外は span に記録して再スロー。
 *
 * @graph-connects opentelemetry [calls] startActiveSpan + setStatus + recordException
 */
export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: () => Promise<T> | T,
  tracerName = "self-management",
): Promise<T> {
  const tracer = trace.getTracer(tracerName);
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const out = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return out;
    } catch (e) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: e instanceof Error ? e.message : String(e),
      });
      if (e instanceof Error) span.recordException(e);
      throw e;
    } finally {
      span.end();
    }
  });
}
