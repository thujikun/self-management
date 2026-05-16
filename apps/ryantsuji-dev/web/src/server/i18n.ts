/**
 * ryantsuji.dev の多言語切替 helper。posts は `<slug>.en.md` / `<slug>.ja.md` の
 * pair で持ち、優先 lang を decide する。
 *
 * **decision priority** (上ほど強い):
 * 1. `?lang=` search param (override): shared link / 一時的な明示切替。検出した
 *    場合は `LANG_COOKIE` を上書きする (server fn が Set-Cookie を返す)
 * 2. `LANG_COOKIE` (`ryantsuji_lang`): user が LangSwitcher で選んだ persistent 設定
 * 3. `Accept-Language` header (browser): 初訪問時の自然な default
 * 4. `en` (final fallback): dev.to を SoT に持ってきた経緯
 *
 * 対応 lang は **`en` / `ja`** のみ。post 側で要求 lang variant が無い場合の
 * fallback は `posts.ts:variantFor` で en preferred → 他 lang。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 投稿 page の多言語切替の共通基盤。`?lang=` override > cookie > Accept-Language > en の 4 段優先で Lang を決定する pure helper を提供。LangSwitcher 押下時は client で cookie を書き換える形で永続化、`?lang=` 経由でも server fn が cookie を Set し UI が伝播する
 * @graph-connects none
 */

/** @graph-connects none */
export type Lang = "en" | "ja";

/**
 * 対応 lang の一覧 (列挙順は priority ではない、UI 表示順としてのみ使う)。
 *
 * @graph-connects none
 */
export const SUPPORTED_LANGS: readonly Lang[] = ["en", "ja"];

/**
 * `LangSwitcher` 押下時に client が `document.cookie` で書き、server fn が
 * `getRequestHeaders` 経由で読む persistent 設定 cookie 名。
 *
 * @graph-connects none
 */
export const LANG_COOKIE = "ryantsuji_lang";

/**
 * cookie の max-age (秒)。1 年。
 *
 * @graph-connects none
 */
export const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** @graph-connects none */
export function isLang(value: unknown): value is Lang {
  return value === "en" || value === "ja";
}

/**
 * Cookie ヘッダー文字列から `LANG_COOKIE` の値を抽出する。`document.cookie` も同
 * 形式 (`a=1; b=2`)。Lang として valid な値のみ返し、それ以外は null。
 *
 * @graph-connects none
 */
export function parseLangCookie(cookieHeader: string | null | undefined): Lang | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name !== LANG_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    return isLang(value) ? value : null;
  }
  return null;
}

/**
 * `Set-Cookie` ヘッダー値を構築する。`Lax` で同 origin navigation で送られ、
 * `Path=/` で全 route に効かせる。`Secure` は production だけ付ける想定 (dev は HTTP)
 * だが、ブラウザは Secure 無しでも同 origin なら受理するので env-agnostic に Secure
 * を常時付ける形にしない。
 *
 * @graph-connects none
 */
export function buildLangSetCookie(lang: Lang): string {
  return `${LANG_COOKIE}=${lang}; Path=/; Max-Age=${LANG_COOKIE_MAX_AGE}; SameSite=Lax`;
}

/**
 * 優先 lang を decide する pure 関数。priority: override > cookie > Accept-Language > en。
 *
 * @graph-connects none
 */
export function pickLang(args: {
  override?: unknown;
  cookieLang?: Lang | null;
  acceptLanguage?: string | null;
}): Lang {
  if (isLang(args.override)) return args.override;
  if (args.cookieLang) return args.cookieLang;
  const al = args.acceptLanguage;
  if (!al) return "en";
  const tokens = al
    .toLowerCase()
    .split(",")
    .map((s) => s.trim().split(";")[0] ?? "");
  for (const tok of tokens) {
    if (tok.startsWith("ja")) return "ja";
    if (tok.startsWith("en")) return "en";
  }
  return "en";
}
