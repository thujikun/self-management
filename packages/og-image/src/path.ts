/**
 * og:image の public path convention。`coverPublicPath(slug, lang)` が **唯一の SoT**
 * で、generator (scripts/generate-covers.ts) と consumer (route の og:image meta /
 * JSON-LD / sitemap) が同じ helper を経由することで convention 差異による silent
 * 404 を構造的に排除する。
 *
 * 純粋 string helper のみで、I/O や生成依存 (satori / resvg) には触れない。consumer 側
 * の bundler が path だけを treeshake で取り出せる構造に保つ。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business og:image の public path convention の SoT。`/posts/<slug>.<lang>.cover.png` を pure helper で固定し、generator と consumer (route head / JSON-LD) の double-source-of-truth による 404 drift を排除する
 * @graph-connects none
 */

import type { OgLang } from "./generate.js";

/**
 * post の og:image (cover PNG) を `/posts/...` 配下に site-relative で返す。
 *
 * generator (`scripts/generate-covers.ts`) は本 path に PNG を書き、consumer
 * (`apps/ryantsuji-dev/web/src/routes/posts/$slug.tsx` の og:image / twitter:image /
 * JSON-LD image) は本 path を absolute URL で参照する。両者が同じ helper を経由する
 * ことで convention 差異による silent 404 を構造的に排除する。
 *
 * @graph-connects none
 */
export function coverPublicPath(slug: string, lang: OgLang): string {
  return `/posts/${slug}.${lang}.cover.png`;
}
