/**
 * ryantsuji.dev の多言語切替 helper。posts は `<slug>.en.md` / `<slug>.ja.md` の
 * pair で持ち、user の `Accept-Language` ヘッダーから優先 lang を決定する。`?lang=`
 * search param は最優先で override する (toggle UI / 外部リンクで明示的に切替えたい
 * ケースに使う)。
 *
 * 対応 lang は **`en` / `ja`** のみ。未対応 lang の Accept-Language が来ても fallback
 * は `en` (dev.to を SoT に持ってきた経緯から英語優先)。post 側で `ja` variant しか
 * 無い場合は呼び出し側で other-lang fallback を取る (`posts.ts:variantFor` 参照)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 投稿 page の多言語切替の共通基盤。Accept-Language header と ?lang= override から `en` / `ja` を決定する pure helper を提供し、posts.ts / route loader / UI toggle で同じ規則を使う。dev.to を SoT に持ってきた経緯から fallback は en
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

/** @graph-connects none */
export function isLang(value: unknown): value is Lang {
  return value === "en" || value === "ja";
}

/**
 * `Accept-Language` header + override から優先 lang を決定する pure 関数。
 *
 * - override (`?lang=` query) が `en` / `ja` ならそれを最優先
 * - そうでなければ Accept-Language を先頭から走査して `ja` / `en` どちらか先に
 *   match した方を採用
 * - どちらも該当しなければ `en` fallback
 *
 * 注: q-value は実用上ブラウザは降順で並べてくれるので個別解釈しない
 * (RFC 7231 strict parsing は本機能の SLO に対して過剰)。
 *
 * @graph-connects none
 */
export function pickLang(acceptLanguage: string | null | undefined, override?: unknown): Lang {
  if (isLang(override)) return override;
  if (!acceptLanguage) return "en";
  const tokens = acceptLanguage
    .toLowerCase()
    .split(",")
    .map((s) => s.trim().split(";")[0] ?? "");
  for (const tok of tokens) {
    if (tok.startsWith("ja")) return "ja";
    if (tok.startsWith("en")) return "en";
  }
  return "en";
}
