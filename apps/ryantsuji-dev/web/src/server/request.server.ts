/**
 * server-only な request header 取得 helper の集約点。
 *
 * `@tanstack/react-start/server` の `getRequestHeaders` は client bundle に乗ると
 * vite の import-protection plugin に弾かれるため、import を含むファイルは
 * `.server.ts` で隔離する必要がある。`server/i18n.ts` は client / SSR 両方から
 * import される pure helper なので、ここに混ぜると client bundle が汚染される。
 *
 * 用途: `routes/posts/$slug.server.ts` / `routes/posts/index.server.ts` の loader が
 * Accept-Language を読み取って `pickLang` に渡す経路を 1 箇所に集約し、両 file の
 * 逐字コピーを排除する (SoT 化)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business server-only な request header 取得 helper (Accept-Language) を集約する SoT。getRequestHeaders を含む server-only import を持つため .server.ts で client bundle から隔離し、複数 route loader からの逐字コピーを排除する
 * @graph-connects tanstack-start [calls] getRequestHeaders で request header を読む
 */

import { getRequestHeaders } from "@tanstack/react-start/server";

/**
 * Accept-Language header を取得する。server runtime 外 (= AsyncLocalStorage に
 * StartEvent が無い場合, e.g. vitest 環境) で `getRequestHeaders` が throw するため
 * try/catch で握りつぶし `null` を返す。呼び出し側 (`pickLang`) は null を受けたら
 * en fallback に倒す。
 *
 * @graph-connects tanstack-start [calls] getRequestHeaders で Accept-Language を読む
 */
export function safeAcceptLanguage(): string | null {
  try {
    const headers = getRequestHeaders() as unknown as Record<string, string | undefined>;
    return headers["accept-language"] ?? null;
  } catch {
    return null;
  }
}
