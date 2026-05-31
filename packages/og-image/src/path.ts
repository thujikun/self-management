/**
 * og:image の public path convention。`coverPublicPath(slug, lang)` が **唯一の SoT**
 * で、generator (content repo `ryantsuji-dev-content` の `scripts/generate-cover.mjs`)
 * と consumer (route の og:image meta / JSON-LD / sitemap) が同じ convention を
 * 経由することで convention 差異による silent 404 を構造的に排除する。
 *
 * 純粋 string helper のみで、I/O や生成依存 (satori / resvg) には触れない。
 * `./generate.ts` への import 経路を 1 つでも持つと、consumer (Cloudflare Worker bundle
 * 等) の vite build が `@resvg/resvg-js` の native binding まで module graph で
 * 辿って `[commonjs--resolver] Parse error` で fail する (= PR #111 で実観測)。
 * そのため `OgLang` の type 定義も本ファイルに置き、`./generate.ts` 側から逆 import する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business og:image の public path convention の SoT。`/images/posts/<slug>.<lang>.cover.png` を pure helper で固定し、generator と consumer (route head / JSON-LD) の double-source-of-truth による 404 drift を排除する。worker bundle が satori/resvg を pull しないよう、`./generate.ts` への import を 0 件に保つ
 * @graph-connects none
 */

/**
 * og:image の lang。`ja` / `en` の二値。`./generate.ts` の `OgImageInput.lang` でも
 * 同 type を使うため、本 file (= 純粋 helper 層) を SoT に置き `./generate.ts` 側で
 * 再 export する。
 *
 * @graph-connects none
 */
export type OgLang = "ja" | "en";

/**
 * post の og:image (cover PNG) を `/images/posts/...` 配下に site-relative で返す。
 *
 * 2026-05 に cover 生成の責務を content repo (ryantsuji-dev-content) 側に移行した
 * のに合わせて path scheme も `/posts/<slug>.<lang>.cover.png` → `/images/posts/<slug>.<lang>.cover.png`
 * に変更している (content repo の `/images/*` R2 route に揃えるため)。PNG は content
 * repo (ryantsuji-dev-content) の `images/posts/<slug>.<lang>.cover.png` に置かれ、
 * `/images/*` route 経由で配信される。本 helper は consumer
 * (`apps/ryantsuji-dev/web/src/routes/posts/$slug.tsx` の og:image / twitter:image /
 * JSON-LD image) と gate (`scripts/check-covers-exist.ts`) が同じ convention で
 * path を組むための唯一の SoT として残す。
 *
 * @graph-connects none
 */
export function coverPublicPath(slug: string, lang: OgLang): string {
  return `/images/posts/${slug}.${lang}.cover.png`;
}

/**
 * 本 slug の og:image (cover PNG) を生成・存在要求の対象に含めるかを返す。
 *
 * `_` 始まり slug は test fixture (e.g. `_minimal-fixture` / `_draft-example`)。
 * production / syndication に露出しないので PNG 生成も存在要求もしない。
 *
 * content repo (ryantsuji-dev-content) 側 generator (`scripts/generate-cover.mjs`) と
 * gate (`findMissingCovers`) の両方が同 規約を参照することで、「PNG を吐く対象」と
 * 「PNG 存在を要求する対象」が機械的に一致する。規約変更 (`_` → `__` / `draft:`
 * frontmatter 化 等) は本 helper の 1 箇所更新で済む。
 *
 * @graph-connects none
 */
export function shouldHaveCover(slug: string): boolean {
  return !slug.startsWith("_");
}
