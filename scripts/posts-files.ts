/*
 * content/posts/ 配下の `.{en,ja}.md` ファイル列挙の純粋寄り helper 層。
 *
 * `@self/content` を経由せず、`gray-matter` のみで frontmatter の `draft` フラグだけ
 * 軽量に読む。`@self/content` の `parseFrontmatter` は dist build artifact (= turbo
 * `^build`) を要求し、CI 並列 matrix の `gate (covers-exist)` のような「build を待たず
 * 単体で動く gate」が `ERR_MODULE_NOT_FOUND` で fail する原因になる (PR #111 で実観測)。
 *
 * 本 module は dist build を要求しない (`gray-matter` は npm dep / `@self/og-image/path`
 * は subpath で worker bundle にも安全な pure helper のみ) ので、CI gate の前段層として
 * 単体起動できる。
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business content/posts/ 配下の md ファイル列挙の lightweight 層。`@self/content` dist 不在でも単体で動き、CI gate (covers-exist 等) が build と並列に走れる。frontmatter は draft フラグのみ参照
 * @graph-connects og-image [calls] @self/og-image/path の OgLang 型を post の lang field 型として使う
 */

import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import matter from "gray-matter";

import type { OgLang } from "@self/og-image/path";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPTS_DIR, "..");

/** content/posts/ の絶対 path。`scripts/syndicate.ts` の `POSTS_DIR` と同値。 */
export const POSTS_DIR = resolve(REPO_ROOT, "apps/ryantsuji-dev/web/content/posts");

/** parse 済みの 1 entry。slug + lang のみ。 */
export interface PostFileEntry {
  slug: string;
  lang: OgLang;
}

/**
 * `<slug>.<lang>.md` のファイル名を slug + lang に分解。slug 規約は `[_a-z0-9][_a-z0-9-]*`
 * (`syndicate.ts` の `parseFileName` と同 regex、SoT として本 module 側に置く)。
 *
 * 大文字混じり filename は silently 受け入れない (= 小文字側 slug と map で衝突 / miss
 * する事故防止、`link-rewriter.ts` の `/g` flag 判断と同じ)。
 *
 * @graph-connects none
 */
export function parseFileName(name: string): { slug: string; lang: OgLang } | null {
  const m = /^([_a-z0-9][_a-z0-9-]*)\.(en|ja)\.md$/u.exec(name);
  if (!m) return null;
  return { slug: m[1] as string, lang: m[2] as OgLang };
}

/**
 * `postsDir` 配下の `<slug>.<lang>.md` を全て列挙し、`draft: true` を除いた entry を
 * 返す。frontmatter の他フィールドは読まない (= zod schema 不要、`@self/content` 非依存)。
 *
 * gate / 列挙系 script の単体起動用。フル frontmatter parse が必要な consumer
 * (`syndicate.ts` の `readAllPosts` 等) は別経路で `@self/content` を経由する。
 *
 * @graph-connects none
 */
export async function listPublishedPostFiles(
  postsDir: string = POSTS_DIR,
): Promise<PostFileEntry[]> {
  const files = await readdir(postsDir);
  const out: PostFileEntry[] = [];
  for (const f of files) {
    const parsed = parseFileName(f);
    if (!parsed) continue;
    const raw = await readFile(resolve(postsDir, f), "utf8");
    const data = matter(raw).data as { draft?: unknown };
    if (data.draft === true) continue;
    out.push({ slug: parsed.slug, lang: parsed.lang });
  }
  return out;
}
