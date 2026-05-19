/*
 * check-covers-exist logic — content/posts/*.{ja,en}.md 全てに対して
 * `apps/ryantsuji-dev/web/public/posts/<slug>.<lang>.cover.png` の存在を確認する。
 *
 * Why: PR #111 で「frontmatter に cover が無い時は convention path に fallback」
 * へ移行した結果、PNG 未生成のまま merge / deploy すると og:image が 404 を指して
 * Slack / Twitter の unfurl が broken image を cache する事故が起き得る。
 *
 * generator (`scripts/generate-covers.ts`) は手動 (`pnpm covers:generate`) なので、
 * 「PNG を吐く / 吐かない」と「md を merge する / しない」が独立して動く。本 check
 * は両者を merge 前に意図的に交差させる gate。
 *
 * 設計 (compact-log / syndicate / generate-covers と同じ):
 * - pure logic は本ファイル (副作用は引数で受け取る existsSync 同等の述語のみ)
 * - filesystem I/O / process.exit / stdout の glue は `check-covers-exist.cli.ts`
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business covers-exist gate の pure logic 層。posts list と存在述語を受け取り、欠落 (slug, lang) を列挙する。`_` 始まり fixture は skip
 * @graph-connects none
 */

import { coverPublicPath, type OgLang } from "@self/og-image";

/** content/posts から拾った 1 entry。slug + lang のみで十分。 */
export interface PostEntry {
  slug: string;
  lang: OgLang;
}

/** 欠落 1 件。CLI が stderr に出して exit 1 する。 */
export interface MissingCover {
  slug: string;
  lang: OgLang;
  /** site-relative path (`/posts/<slug>.<lang>.cover.png`)、debug 用 */
  publicPath: string;
}

/**
 * `posts` に対応する PNG が存在するかを `exists` 述語で確認、欠落を返す。
 *
 * `_` 始まり slug は test fixture (e.g. `_minimal-fixture` / `_draft-example`)。
 * production 露出も syndication 露出もしないので、PNG 生成も要求しない (= skip)。
 *
 * `exists` は CLI 側が `existsSync(publicDir/...)` 等で実装する。logic は I/O に
 * 触らない pure 関数。
 *
 * @graph-connects none
 */
export function findMissingCovers(
  posts: ReadonlyArray<PostEntry>,
  exists: (publicPath: string) => boolean,
): MissingCover[] {
  const missing: MissingCover[] = [];
  for (const p of posts) {
    if (p.slug.startsWith("_")) continue;
    const publicPath = coverPublicPath(p.slug, p.lang);
    if (!exists(publicPath)) {
      missing.push({ slug: p.slug, lang: p.lang, publicPath });
    }
  }
  return missing;
}
