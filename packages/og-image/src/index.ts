/**
 * `@self/og-image` — ryantsuji.dev の og:image を build-time に PNG 生成する。
 *
 * satori (VNode → SVG) + @resvg/resvg-js (SVG → PNG) の 2 段。lang 共通の brand
 * 横長 (dark BG / rt logo / serif title / tiffany-teal accent) 1 種のみ。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 個人ブログ ryantsuji.dev の og:image を frontmatter から自動生成する package。JP/EN 共通 brand template (rt logo + serif title + teal accent) を satori で SVG にして resvg で PNG (1200x630) を吐く。run-time ではなく build-time / script-time 生成、生成 PNG は public/ に置いて静的 serve する想定
 * @graph-connects none
 */

export { renderOgImage, renderSiteOgImage } from "./generate.js";
export type { OgImageInput, OgLang, OgFonts } from "./generate.js";

export { coverPublicPath } from "./path.js";
