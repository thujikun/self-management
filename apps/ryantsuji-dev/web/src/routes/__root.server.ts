/**
 * `__root` route の **server-only** ロジック。current lang (cookie / Accept-Language)
 * を解決して全 page の SiteHeader に流す。
 *
 * `@tanstack/react-start/server` を経由する helper (`safeCookieLang` /
 * `safeAcceptLanguage` etc.) を route 本体 (`__root.tsx`) から隔離するため、
 * `$slug.server.ts` / `index.server.ts` と同じ pattern で `.server.ts` ファイルに置く。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business root loader が全 page で current lang を共通解決する SoT。LangSwitcher の active state や header の lang 表示で route loader data を奪い合わず、cookie 1 元管理に揃える。priority は pickLang と同じ (cookie > Accept-Language > en)
 * @graph-connects content [calls] pickLang で current lang を確定
 */

import type { Lang } from "../server/i18n.js";
import { pickLang } from "../server/i18n.js";
import {
  safeAcceptLanguage,
  safeCookieLang,
  safeCookieTheme,
  safeUrlLang,
} from "../server/request.server.js";
import { pickTheme, type Theme } from "../server/theme.js";

/**
 * SiteHeader / LangSwitcher / ThemeSwitcher が「いまどの lang/theme を serve して
 * いるか」を知るための minimal resolver。route の loader を介して全 page から共通
 * 取得できる。
 *
 * priority は `pickLang` と同じ: `?lang=` override > cookie > Accept-Language > en。
 * URL override を取らないと「URL は `?lang=en` だが cookie/Accept-Language が ja
 * で LangSwitcher だけ JA active になる」(= UI 状態と実 lang の乖離) が起きるため、
 * root 側でも URL を読む。theme は URL query 経路を持たない (cookie のみ)。
 *
 * @graph-connects content [calls] pickLang / pickTheme
 */
export function runResolveLang(): { lang: Lang; theme: Theme | null } {
  const lang = pickLang({
    override: safeUrlLang(),
    cookieLang: safeCookieLang(),
    acceptLanguage: safeAcceptLanguage(),
  });
  const theme = pickTheme({ cookieTheme: safeCookieTheme() });
  return { lang, theme };
}
