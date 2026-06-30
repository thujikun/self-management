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
 * 内部 Map: slug → { variants: { en?, ja? } }。**全 variant を時刻非依存で構築**し、
 * process 寿命で 1 度だけ memo する (`rendered` は build 成果物で deploy 間 immutable)。
 *
 * 公開境界 (`publishedAt <= now`) はこの memo に**焼き込まない**。pending 判定を
 * 構築段階で固定すると、予約投稿が時刻到来後も同一 isolate が生きている限り stale な
 * まま公開されない。公開可否は `visibleEntries()` が per-request に評価する。
 *
 * @graph-connects none
 */
let _entries: Map<string, PostEntry> | null = null;

/** @graph-connects none */
function buildEntries(): Map<string, PostEntry> {
  const out = new Map<string, PostEntry>();
  for (const [filename, doc] of Object.entries(rendered)) {
    const parsed = parseFilename(filename);
    if (!parsed) continue;
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
function allEntries(): Map<string, PostEntry> {
  if (!_entries) _entries = buildEntries();
  return _entries;
}

/**
 * variant の `publishedAt` が現在時刻より未来 (= pending / 旧 draft: true 相当) か。
 * `Date.now()` を都度読むので、予約時刻の到来で公開判定が flip する。
 *
 * @graph-connects none
 */
function isPending(variant: PostVariant): boolean {
  return new Date(variant.meta.publishedAt).getTime() > Date.now();
}

/**
 * memo 済の全 entry に対し、公開境界を **per-request** に適用した view を返す。
 *
 * - `includeDrafts: true` (admin preview): pending variant も残した全 entry をそのまま
 * - default (public): `publishedAt <= now` の variant のみ残し、可視 variant が 0 件に
 *   なった entry は Map から落とす (= pending は variant 単位で filter)
 *
 * memo は variant 構築のみキャッシュし公開判定はキャッシュしないので、予約投稿は
 * isolate を再起動せずとも時刻到来で listing / detail に自動的に現れる。
 *
 * @graph-connects none
 */
function visibleEntries(includeDrafts: boolean): Map<string, PostEntry> {
  if (includeDrafts) return allEntries();
  const out = new Map<string, PostEntry>();
  for (const [slug, entry] of allEntries()) {
    const variants: Partial<Record<Lang, PostVariant>> = {};
    for (const lang of SUPPORTED_LANGS) {
      const variant = entry.variants[lang];
      if (variant && !isPending(variant)) variants[lang] = variant;
    }
    if (SUPPORTED_LANGS.some((lang) => variants[lang])) {
      out.set(slug, { slug, variants });
    }
  }
  return out;
}

/**
 * 要求 lang の variant を優先、無ければ `en` variant に fallback、en も無ければ
 * `SUPPORTED_LANGS` の順に他 lang を試す。`visibleEntries()` は variant 0 件の post を
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
 * `includeDrafts: true` の時のみ pending (publishedAt 未来) variant も含む (admin
 * preview 経路)。既存 caller (= flag 省略) は `false` 動作と等価。
 *
 * @graph-connects none
 */
export function listPosts(lang: Lang, options: { includeDrafts?: boolean } = {}): PostListItem[] {
  return [...visibleEntries(options.includeDrafts ?? false).values()]
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
 * fallback。存在しないか全 variant が pending (publishedAt 未来、かつ admin でない)
 * なら null。
 *
 * `includeDrafts: true` の時のみ pending variant も lookup 対象に入る。
 *
 * @graph-connects none
 */
export function getRenderedPost(
  slug: string,
  lang: Lang,
  options: { includeDrafts?: boolean } = {},
): RenderedPostResult | null {
  const entry = visibleEntries(options.includeDrafts ?? false).get(slug);
  if (!entry) return null;
  const picked = variantFor(entry, lang);
  return {
    rendered: picked.variant.rendered,
    servedLang: picked.servedLang,
    availableLangs: availableLangs(entry),
  };
}
