/**
 * 投稿 (.md) source を build-time に bundle 化する loader。
 *
 * filename 規約: `<slug>.<lang>.md` (e.g. `db-graph-mcp.en.md`, `db-graph-mcp.ja.md`)。
 * 同 slug の lang variant が複数あれば pair として扱い、`listPosts(lang)` /
 * `getPostSource(slug, lang)` が指定 lang を返す。**その言語の variant が無い時の
 * fallback は常に `en`** (dev.to import を SoT に揃えたので en は全 post に存在する
 * 前提)。
 *
 * `import.meta.glob('../../content/posts/*.{en,ja}.md', { query: '?raw', eager: true })`
 * で vite が markdown を string として静的に inline。runtime (CF Workers) で fs に
 * 触らない。
 *
 * frontmatter 抽出は `gray-matter` を使い、`@self/content` の Zod schema で validate。
 * slug は **ファイル名 (`<slug>.<lang>.md` の slug 部分) を authoritative** に扱い、
 * frontmatter 側の slug 値は採用しない (lang variant 間で slug を揃える運用と矛盾
 * しないようにするため)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 投稿 markdown を vite の import.meta.glob で build-time に inline、CF Workers 上では fs を一切触らずに loader が機能する。`<slug>.<lang>.md` 規約で en/ja の pair を持ち、listPosts/getPostSource は要求 lang を優先 + 無ければ en fallback。dedupe は slug 単位で行う
 * @graph-connects content [calls] @self/content の parseFrontmatter で各 source の frontmatter を Zod validate
 */

import matter from "gray-matter";
import { parseFrontmatter, type Frontmatter } from "@self/content";

import { SUPPORTED_LANGS, type Lang } from "./i18n.js";

/** @graph-connects none */
interface RawSource {
  default: string;
}

/**
 * vite が build-time に `../../content/posts/*.{en,ja}.md` を `?raw` で全 inline。
 * key は filesystem path、value は markdown 全文 (frontmatter 込み)。
 *
 * @graph-connects none
 */
const rawSources = import.meta.glob<RawSource>("../../content/posts/*.{en,ja}.md", {
  query: "?raw",
  eager: true,
});

/**
 * post 一覧 / 詳細で使う meta 情報。frontmatter (= `Frontmatter`) に **ファイル名由来の
 * authoritative な `slug` / `lang`** を必ず付けたサブセット。`Frontmatter` schema
 * 側はこの 2 field を持たないので、上書きではなくここで初めて付与される。
 *
 * @graph-connects none
 */
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
 * 詳細取得の戻り値。source markdown + 実 serve lang + 利用可能 lang 集合。
 *
 * @graph-connects none
 */
export interface PostSourceResult {
  source: string;
  servedLang: Lang;
  availableLangs: Lang[];
}

/** @graph-connects none */
interface PostVariant {
  meta: PostMeta;
  source: string;
}
/** @graph-connects none */
interface PostEntry {
  slug: string;
  variants: Partial<Record<Lang, PostVariant>>;
}

/**
 * `../../content/posts/<slug>.<lang>.md` から { slug, lang } を抜き出す。
 *
 * @graph-connects none
 */
function parsePath(path: string): { slug: string; lang: Lang } | null {
  // `lastIndexOf("/")` が -1 なら +1 = 0 で先頭から、`/` を含むなら最後の `/` の
  // 直後から末尾までを basename として切る。null 経路を持たず `??` の分岐を回避。
  const base = path.substring(path.lastIndexOf("/") + 1);
  const match = base.match(/^(.+)\.(en|ja)\.md$/);
  if (!match) return null;
  // 正規表現に必須の 2 capture group があるので match 成功時は両方とも存在する。
  return { slug: match[1] as string, lang: match[2] as Lang };
}

/**
 * source から frontmatter を抜き出して PostMeta に。`slug` / `lang` は **ファイル名
 * `<slug>.<lang>.md` を authoritative** に扱い、frontmatter 側に書かれた同名 field は
 * `FrontmatterSchema` の strip で落としてからここで filename 由来の値を注入する。
 *
 * @graph-connects content [calls] parseFrontmatter で Zod validate
 */
function toMeta(slug: string, lang: Lang, source: string): PostMeta {
  const { data } = matter(source);
  const fm = parseFrontmatter(data);
  return { ...fm, slug, lang };
}

/**
 * 内部 Map: slug → { variants: { en?, ja? } }。`draft: true` の variant は **構築段階
 * で除外** する (どちらかの lang だけ draft でも、その lang を listPosts / getPostSource
 * が返さないようにするため)。
 *
 * @graph-connects none
 */
let _entries: Map<string, PostEntry> | null = null;
/** @graph-connects none */
function entries(): Map<string, PostEntry> {
  if (_entries) return _entries;
  const out = new Map<string, PostEntry>();
  for (const [path, mod] of Object.entries(rawSources)) {
    // glob `*.{en,ja}.md` が parsePath の正規表現と一致する規約のため、本ループ内で
    // parsePath が null を返すことは無い (test 経由の __testing.parsePath では null
    // 経路を網羅)。non-null assertion で defensive 分岐を消す。
    const parsed = parsePath(path) as { slug: string; lang: Lang };
    const meta = toMeta(parsed.slug, parsed.lang, mod.default);
    if (meta.draft) continue;
    let entry = out.get(parsed.slug);
    if (!entry) {
      entry = { slug: parsed.slug, variants: {} };
      out.set(parsed.slug, entry);
    }
    entry.variants[parsed.lang] = { meta, source: mod.default };
  }
  _entries = out;
  return out;
}

/**
 * 要求 lang の variant を優先、無ければ `en` variant に fallback、en も無ければ
 * `SUPPORTED_LANGS` の順に他 lang を試す。`entries()` は variant 0 件の post を
 * Map に入れないので必ず何か返る (unreachable 経路は防御的に throw)。
 *
 * Ryan の元方針は「en fallback で OK」だが、ja-only post を将来追加した時に entry
 * が listing から消える事故を防ぐため、最終 fallback として他 lang も拾う形にする。
 *
 * @graph-connects none
 */
function variantFor(entry: PostEntry, lang: Lang): { variant: PostVariant; servedLang: Lang } {
  const direct = entry.variants[lang];
  if (direct) return { variant: direct, servedLang: lang };
  // `SUPPORTED_LANGS` は en, ja の順なので en preferred fallback になる。entry 内に
  // 1 variant 以上ある invariant (`entries()` で保証) のもと、必ず何か返る。
  for (const fallback of SUPPORTED_LANGS) {
    const v = entry.variants[fallback];
    if (v) return { variant: v, servedLang: fallback };
  }
  // 到達した場合は `entries()` の invariant 破れ。silent fallback ではなく明示的に
  // log + throw して上位で原因解析できるようにする。
  console.error(`[posts] empty variants for slug=${entry.slug}`);
  throw new Error(`empty variants for ${entry.slug}`);
}

/**
 * unit test から内部関数 (variantFor / parsePath) に直接到達して防御的経路まで網羅
 * するための export。production code は import しない。
 *
 * @graph-connects none
 */
export const __testing = { variantFor, parsePath };

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
 * 利用可能 lang を返す (`publishedAt` 降順)。要求 lang が無い post は en fallback meta
 * を返し、`servedLang` で実際の lang を示す。
 *
 * **`_` prefix slug は production 一覧から除外** する (e.g. `_minimal-fixture` / test
 * fixture)。`getPostSource(slug, lang)` 経由の直接アクセスは引続き可能なので、
 * `$slug.test.tsx` などの test fixture は URL では届く一方で `/posts` 一覧の publishing
 * surface には現れない (draft: true は `entries()` 段階で全経路から落ちる separate な
 * mechanism; こちらは listing から隠すだけの「内部 fixture」用 convention)。
 *
 * @graph-connects content [calls] parseFrontmatter で各 source の Frontmatter を抽出
 */
export function listPosts(lang: Lang): PostListItem[] {
  return [...entries().values()]
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
 * 公開 API: slug から markdown source 全文 (frontmatter 込み) を返す。
 * 要求 lang が無ければ en fallback。存在しないか全 variant draft なら null。
 *
 * @graph-connects none
 */
export function getPostSource(slug: string, lang: Lang): PostSourceResult | null {
  const entry = entries().get(slug);
  if (!entry) return null;
  const picked = variantFor(entry, lang);
  return {
    source: picked.variant.source,
    servedLang: picked.servedLang,
    availableLangs: availableLangs(entry),
  };
}
