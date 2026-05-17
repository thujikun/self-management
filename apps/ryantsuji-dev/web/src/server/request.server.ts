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

import { getCookie, getRequestHeaders, setCookie } from "@tanstack/react-start/server";

import { isAdminRequest } from "./auth-session.js";
import { LANG_COOKIE, LANG_COOKIE_MAX_AGE, isLang, type Lang } from "./i18n.js";
import { THEME_COOKIE, THEME_COOKIE_MAX_AGE, isTheme, type Theme } from "./theme.js";
import type { Env } from "../start.js";

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

/**
 * `LANG_COOKIE` を読み取り valid な Lang のみ返す。invalid / 未設定は null。
 * test runtime では getCookie が throw するので try/catch。
 *
 * @graph-connects tanstack-start [calls] getCookie で persistent lang 設定を読む
 */
export function safeCookieLang(): Lang | null {
  try {
    const value = getCookie(LANG_COOKIE);
    return isLang(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * `LANG_COOKIE` を Set-Cookie response header で書く。試 runtime では setCookie が
 * 無効化 / throw するので try/catch (test では cookie 書き込みが side effect になら
 * ない前提で済む)。
 *
 * `SameSite=Lax` で同 origin navigation でも送られ、`Path=/` で全 route 共通。
 *
 * @graph-connects tanstack-start [calls] setCookie で persistent lang を書く
 */
export function writeLangCookie(lang: Lang): void {
  try {
    setCookie(LANG_COOKIE, lang, {
      path: "/",
      maxAge: LANG_COOKIE_MAX_AGE,
      sameSite: "lax",
    });
  } catch {
    // test runtime 等で無効、business 影響なし
  }
}

/**
 * `THEME_COOKIE` を読み取り valid な Theme のみ返す。未設定は null (= system 任せ)。
 *
 * @graph-connects tanstack-start [calls] getCookie で theme 設定を読む
 */
export function safeCookieTheme(): Theme | null {
  try {
    const value = getCookie(THEME_COOKIE);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * `THEME_COOKIE` を Set-Cookie response header で書く。
 *
 * @graph-connects tanstack-start [calls] setCookie で theme を書く
 */
export function writeThemeCookie(theme: Theme): void {
  try {
    setCookie(THEME_COOKIE, theme, {
      path: "/",
      maxAge: THEME_COOKIE_MAX_AGE,
      sameSite: "lax",
    });
  } catch {
    // test runtime 等で無効
  }
}

/**
 * 現在の request の Headers をそのまま Headers object として返す。`safeAcceptLanguage`
 * と同じく runtime 外では throw する getRequestHeaders を try/catch で握りつぶし、
 * 取れなければ null を返す。
 *
 * @graph-connects tanstack-start [calls] getRequestHeaders で全 header を取り出す
 */
export function safeRequestHeaders(): Headers | null {
  try {
    const raw = getRequestHeaders() as unknown as Record<string, string | undefined>;
    const h = new Headers();
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === "string") h.set(k, v);
    }
    return h;
  } catch {
    return null;
  }
}

/**
 * 現在 request の session.user.email が `env.ADMIN_EMAIL` と一致するか。loader が
 * draft preview の可視性を決める時に使う。runtime 外 (test 等) では headers が無く
 * false を返すので、テスト経由では default で draft は除外される。
 *
 * @graph-connects better-auth [calls] isAdminRequest 経由で session.user.email を比較
 */
export async function isAdminFromCurrentRequest(env: Env): Promise<boolean> {
  const headers = safeRequestHeaders();
  if (!headers) return false;
  return await isAdminRequest(headers, env);
}
