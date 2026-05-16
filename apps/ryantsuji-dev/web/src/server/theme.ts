/**
 * ryantsuji.dev の light / dark theme 切替 helper。i18n.ts と並列の user preference。
 *
 * **解決順** (上ほど強い):
 * 1. `THEME_COOKIE` (`ryantsuji_theme`): user が ThemeSwitcher で明示選択した値
 * 2. `null` (= 未設定): system preference (`prefers-color-scheme`) に任せる
 *
 * 出力は `"light" | "dark" | null` で、`null` の時は `<html>` から `data-theme` 属性を
 * 外して CSS の `@media (prefers-color-scheme: dark)` に judging を委ねる。`light` /
 * `dark` 明示時は `data-theme="..."` を付け、tokens.css の `:root[data-theme]` 上書きが
 * 効く (system preference より specificity が高い)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business light/dark theme の user preference cookie ハンドリング基盤。i18n.ts の lang 解決と同 pattern。明示選択時のみ cookie をセットし、未設定時は `prefers-color-scheme` の system default に委ねる
 * @graph-connects none
 */

/** @graph-connects none */
export type Theme = "light" | "dark";

/** @graph-connects none */
export const SUPPORTED_THEMES: readonly Theme[] = ["light", "dark"];

/** @graph-connects none */
export const THEME_COOKIE = "ryantsuji_theme";

/** @graph-connects none */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** @graph-connects none */
export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

/**
 * Cookie ヘッダー文字列から `THEME_COOKIE` の値を抽出する。
 *
 * @graph-connects none
 */
export function parseThemeCookie(cookieHeader: string | null | undefined): Theme | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name !== THEME_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    return isTheme(value) ? value : null;
  }
  return null;
}

/**
 * 解決した theme を返す。cookie 明示 > null (system 任せ)。
 *
 * 注: server 側で `prefers-color-scheme` を読む手段は無いので、cookie 未設定の場合
 * は `null` を返し、`<html>` から `data-theme` を外して system default に従わせる。
 *
 * @graph-connects none
 */
export function pickTheme(args: { cookieTheme?: Theme | null }): Theme | null {
  return args.cookieTheme ?? null;
}
