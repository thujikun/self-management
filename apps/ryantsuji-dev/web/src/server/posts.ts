/**
 * 投稿 (.md) source を build-time に bundle 化する loader。
 *
 * `import.meta.glob('../../content/posts/*.md', { query: '?raw', eager: true })` で
 * vite が markdown を **string として静的に inline** する。runtime (CF Workers) で
 * fs に触らないので Workers の制約に抵触しない。
 *
 * frontmatter 抽出は `gray-matter` を使い、`@self/content` の Zod schema で validate。
 * slug は frontmatter で override でき、なければファイル名 (`<name>.md` の name) を使う。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 投稿 markdown を vite の import.meta.glob で build-time に inline、CF Workers 上では fs を一切触らずに loader が機能する。slug → source の Map と meta 一覧を提供し、route loader はここに依存して post を取り出す
 * @graph-connects content [calls] @self/content の parseFrontmatter で各 source の frontmatter を Zod validate
 */

import matter from "gray-matter";
import { parseFrontmatter, type Frontmatter } from "@self/content";

interface RawSource {
  default: string;
}

/**
 * vite が build-time に `../../content/posts/*.md` を `?raw` で全 inline。
 * key は filesystem path、value は markdown 全文 (frontmatter 込み)。
 *
 * @graph-connects none
 */
const rawSources = import.meta.glob<RawSource>("../../content/posts/*.md", {
  query: "?raw",
  eager: true,
});

/**
 * post 一覧で使う meta 情報。`Frontmatter` に slug を必ず付けたサブセット。
 *
 * @graph-connects none
 */
export interface PostMeta extends Frontmatter {
  slug: string;
}

/**
 * path → "<basename>.md" の name 部分 (slug fallback)。
 *
 * @graph-connects none
 */
function basenameSlug(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.md$/, "");
}

/**
 * source 全文から frontmatter を抜き出して PostMeta に。slug は frontmatter で
 * override 可、なければファイル名から導出する。
 *
 * @graph-connects content [calls] parseFrontmatter で Zod validate
 */
function toMeta(path: string, source: string): PostMeta {
  const { data } = matter(source);
  const fm = parseFrontmatter(data);
  return { ...fm, slug: fm.slug ?? basenameSlug(path) };
}

/**
 * 内部 Map: slug → { meta, source }。`draft: true` は **構築段階で除外** する。
 * これで `listPosts` / `getPostSource` の両方から draft が一元的に見えなくなる
 * (どちらかだけで filter すると経路によって draft が漏れるリスクが残る)。
 *
 * @graph-connects none
 */
interface PublishedEntry {
  meta: PostMeta;
  source: string;
}
/** @graph-connects none */
let _published: Map<string, PublishedEntry> | null = null;
/** @graph-connects none */
function published(): Map<string, PublishedEntry> {
  if (_published) return _published;
  const out = new Map<string, PublishedEntry>();
  for (const [path, mod] of Object.entries(rawSources)) {
    const meta = toMeta(path, mod.default);
    if (meta.draft) continue;
    out.set(meta.slug, { meta, source: mod.default });
  }
  _published = out;
  return out;
}

/**
 * 公開 API: 全 published post の meta を `publishedAt` 降順 (新着順) で返す。
 *
 * @graph-connects content [calls] parseFrontmatter で各 source の Frontmatter を抽出
 */
export function listPosts(): PostMeta[] {
  return [...published().values()]
    .map((e) => e.meta)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

/**
 * 公開 API: slug から markdown source 全文 (frontmatter 込み) を返す。
 * 存在しないか draft なら null (公開経路に draft を漏らさない)。
 *
 * @graph-connects none
 */
export function getPostSource(slug: string): string | null {
  return published().get(slug)?.source ?? null;
}
