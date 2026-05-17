/**
 * 投稿 (.md) を build-time に pre-render してから bundle 化する loader。
 *
 * filename 規約: `<slug>.<lang>.md` (e.g. `db-graph-mcp.en.md`, `db-graph-mcp.ja.md`)。
 * 同 slug の lang variant が複数あれば pair として扱い、`listPosts(lang)` /
 * `getRenderedPost(slug, lang)` が指定 lang を返す。**その言語の variant が無い時の
 * fallback は常に `en`** (dev.to import を SoT に揃えたので en は全 post に存在する
 * 前提)。
 *
 * 旧設計 (vite の eager raw glob で `.md` を inline し runtime で `renderMarkdown`)
 * は長い記事で Worker の CPU 上限を超え Error 1102 を引き起こしていた。新設計は
 * vite plugin (`virtual:rendered-posts`) で build 時に renderMarkdown を全 .md に
 * 走らせて HTML + frontmatter + headings + readingTime を JSON 化し、runtime は
 * lookup のみ。shiki / unified は Worker bundle から完全に除外される。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 投稿 markdown を vite plugin で build-time に pre-render し、CF Workers runtime では shiki を回さず HTML を lookup するだけにする。`<slug>.<lang>.md` 規約で en/ja の pair を持ち、listPosts/getRenderedPost は要求 lang 優先 + 無ければ en fallback。Worker bundle から shiki を完全に外し、Error 1102 を解消する
 * @graph-connects content [calls] @self/content の RenderedDoc を vite plugin 経由で受け取る
 */

import type { Frontmatter, RenderedDoc } from "@self/content";

import { SUPPORTED_LANGS, type Lang } from "./i18n.js";

/**
 * `virtual:rendered-posts` は `vite-plugins/rendered-posts.ts` が提供する仮想 module。
 * 型は `src/virtual-modules.d.ts` で `Record<filename, RenderedDoc>` に宣言済。
 *
 * @graph-connects none
 */
import { renderedPosts } from "virtual:rendered-posts";

/** @graph-connects none */
const rendered: Record<string, RenderedDoc> = renderedPosts;

/** @graph-connects none */
export interface PostMeta extends Frontmatter {
  slug: string;
  lang: Lang;
}

/**
 * 一覧で 1 行ずつ返す型。slug 単位 dedupe 後、当該 user に serve した variant の
 * meta + 利用可能 lang 集合 + 実際に serve した lang。
 *
 * @graph-connects none
 */
export interface PostListItem extends PostMeta {
  availableLangs: Lang[];
  servedLang: Lang;
}

/**
 * 詳細取得の戻り値。pre-rendered HTML + frontmatter + headings + readingTime に
 * lang 情報を載せたもの。SSR loader はこれをそのまま route data に流せる。
 *
 * @graph-connects none
 */
export interface RenderedPostResult {
  rendered: RenderedDoc;
  servedLang: Lang;
  availableLangs: Lang[];
}

/** @graph-connects none */
interface PostVariant {
  meta: PostMeta;
  rendered: RenderedDoc;
}
/** @graph-connects none */
interface PostEntry {
  slug: string;
  variants: Partial<Record<Lang, PostVariant>>;
}

/**
 * filename (`<slug>.<lang>.md`) から { slug, lang } を抜き出す。path prefix が付いて
 * いれば basename だけ取り出して match する (defensive、test の path 入力にも対応)。
 *
 * @graph-connects none
 */
function parseFilename(name: string): { slug: string; lang: Lang } | null {
  const base = name.substring(name.lastIndexOf("/") + 1);
  const match = base.match(/^(.+)\.(en|ja)\.md$/);
  if (!match) return null;
  return { slug: match[1] as string, lang: match[2] as Lang };
}

/**
 * 内部 Map: slug → { variants: { en?, ja? } }。
 *
 * 公開 API は `includeDrafts: boolean` を取り、2 種類の Map を別 memo する:
 * - `_entriesPublic` (default): `draft: true` の variant を構築段階で除外
 * - `_entriesWithDrafts`: 全 variant を含む (admin preview 用)
 *
 * どちらかの lang だけ draft でも、その lang を listPosts / getRenderedPost が返さ
 * ないようにする (= draft = variant 単位の filter)。
 *
 * @graph-connects none
 */
let _entriesPublic: Map<string, PostEntry> | null = null;
/** @graph-connects none */
let _entriesWithDrafts: Map<string, PostEntry> | null = null;

/** @graph-connects none */
function buildEntries(includeDrafts: boolean): Map<string, PostEntry> {
  const out = new Map<string, PostEntry>();
  for (const [filename, doc] of Object.entries(rendered)) {
    const parsed = parseFilename(filename);
    if (!parsed) continue;
    if (doc.frontmatter.draft && !includeDrafts) continue;
    const meta: PostMeta = { ...doc.frontmatter, slug: parsed.slug, lang: parsed.lang };
    let entry = out.get(parsed.slug);
    if (!entry) {
      entry = { slug: parsed.slug, variants: {} };
      out.set(parsed.slug, entry);
    }
    entry.variants[parsed.lang] = { meta, rendered: doc };
  }
  return out;
}

/** @graph-connects none */
function entries(includeDrafts: boolean = false): Map<string, PostEntry> {
  if (includeDrafts) {
    if (!_entriesWithDrafts) _entriesWithDrafts = buildEntries(true);
    return _entriesWithDrafts;
  }
  if (!_entriesPublic) _entriesPublic = buildEntries(false);
  return _entriesPublic;
}

/**
 * 要求 lang の variant を優先、無ければ `en` variant に fallback、en も無ければ
 * `SUPPORTED_LANGS` の順に他 lang を試す。`entries()` は variant 0 件の post を
 * Map に入れないので必ず何か返る (unreachable 経路は防御的に throw)。
 *
 * @graph-connects none
 */
function variantFor(entry: PostEntry, lang: Lang): { variant: PostVariant; servedLang: Lang } {
  const direct = entry.variants[lang];
  if (direct) return { variant: direct, servedLang: lang };
  for (const fallback of SUPPORTED_LANGS) {
    const v = entry.variants[fallback];
    if (v) return { variant: v, servedLang: fallback };
  }
  console.error(`[posts] empty variants for slug=${entry.slug}`);
  throw new Error(`empty variants for ${entry.slug}`);
}

/**
 * unit test から内部関数 (variantFor / parseFilename) に直接到達して防御的経路まで
 * 網羅するための export。production code は import しない。
 *
 * @graph-connects none
 */
export const __testing = { variantFor, parseFilename };

/**
 * entry が抱える利用可能 lang を `SUPPORTED_LANGS` 順で返す (UI badge 表示用)。
 *
 * @graph-connects none
 */
function availableLangs(entry: PostEntry): Lang[] {
  return SUPPORTED_LANGS.filter((l) => entry.variants[l]);
}

/**
 * 公開 API: 全 published post を slug 単位で dedupe し、要求 lang の variant meta +
 * 利用可能 lang を返す (`publishedAt` 降順)。`_` prefix slug は production 一覧から
 * 除外 (test fixture 用 convention)。
 *
 * `includeDrafts: true` の時のみ draft variant も含む (admin preview 経路)。
 * 既存 caller (= flag 省略) は `false` 動作と等価。
 *
 * @graph-connects none
 */
export function listPosts(lang: Lang, options: { includeDrafts?: boolean } = {}): PostListItem[] {
  return [...entries(options.includeDrafts ?? false).values()]
    .filter((entry) => !entry.slug.startsWith("_"))
    .map((entry) => {
      const picked = variantFor(entry, lang);
      return {
        ...picked.variant.meta,
        availableLangs: availableLangs(entry),
        servedLang: picked.servedLang,
      } satisfies PostListItem;
    })
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

/**
 * 公開 API: slug から pre-rendered HTML + meta を返す。要求 lang が無ければ en
 * fallback。存在しないか全 variant draft (かつ admin でない) なら null。
 *
 * `includeDrafts: true` の時のみ draft variant も lookup 対象に入る。
 *
 * @graph-connects none
 */
export function getRenderedPost(
  slug: string,
  lang: Lang,
  options: { includeDrafts?: boolean } = {},
): RenderedPostResult | null {
  const entry = entries(options.includeDrafts ?? false).get(slug);
  if (!entry) return null;
  const picked = variantFor(entry, lang);
  return {
    rendered: picked.variant.rendered,
    servedLang: picked.servedLang,
    availableLangs: availableLangs(entry),
  };
}
