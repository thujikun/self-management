/**
 * 連載 (series) のメタデータ + helper。
 *
 * post frontmatter の `series` / `seriesOrder` を元に同 series の post 群を集めて
 * `seriesOrder` 昇順 (未指定なら `publishedAt` 昇順) で並べる SSoT。
 *
 * 各 series の表示タイトル / tagline は `SERIES_REGISTRY` で一元管理。post 側は
 * slug 参照しか持たないので、連載名を後から変えても全 post を再編集しなくて済む。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 連載 series の registry + helper。post frontmatter の series slug から `/series/<slug>` hub の表示メタ (title / tagline) を解決し、所属 post を seriesOrder 順に整列して返す
 * @graph-connects content [reads_from] listPosts(lang) の出力を series slug で filter / sort
 */

import { listPosts, type PostListItem } from "./posts.js";
import type { Lang } from "./i18n.js";

/** @graph-connects none */
export interface SeriesMeta {
  slug: string;
  title: string;
  tagline: string;
}

/**
 * 連載一覧。slug は post frontmatter の `series` 値と一致させる。
 *
 * 新しい連載を始める時はここに 1 行追加し、対応 post の frontmatter に `series` /
 * `seriesOrder` を入れるだけで `/series/<slug>` hub が自動的に成立する。
 *
 * @graph-connects none
 */
export const SERIES_REGISTRY: Record<string, SeriesMeta> = {
  "building-ai-harness": {
    slug: "building-ai-harness",
    title: "Building AI Harness",
    tagline:
      "Field notes from building cortex — an AI-first dev platform where AI auto-reviews PRs, self-heals ops, and lets non-engineers ship. Harness engineering in production.",
  },
};

/** @graph-connects none */
export function getSeriesMeta(slug: string): SeriesMeta | null {
  return SERIES_REGISTRY[slug] ?? null;
}

/**
 * 指定 series の所属 post を `seriesOrder` 昇順で返す。`seriesOrder` 未指定の post は
 * `publishedAt` 昇順 fallback。同 order が複数あれば `publishedAt` で安定 sort する。
 *
 * `lang` の variant 解決は `listPosts` に委譲しているので、引数 lang variant が無い
 * post は en fallback で出る。
 *
 * @graph-connects content [calls] listPosts(lang)
 */
export function listSeriesPosts(seriesSlug: string, lang: Lang): PostListItem[] {
  return listPosts(lang)
    .filter((p) => p.series === seriesSlug)
    .sort((a, b) => {
      const oa = a.seriesOrder ?? Number.MAX_SAFE_INTEGER;
      const ob = b.seriesOrder ?? Number.MAX_SAFE_INTEGER;
      if (oa !== ob) return oa - ob;
      return a.publishedAt.localeCompare(b.publishedAt);
    });
}

/**
 * 指定 post を含む series 内の (prev / current / next) 情報を返す。post detail の
 * 連載 navigation box に流す。post が series に属さなければ null。
 *
 * @graph-connects content [calls] listSeriesPosts
 */
export function getSeriesNav(
  slug: string,
  lang: Lang,
): {
  meta: SeriesMeta;
  posts: PostListItem[];
  currentIndex: number;
  prev: PostListItem | null;
  next: PostListItem | null;
} | null {
  const all = listPosts(lang);
  const current = all.find((p) => p.slug === slug);
  if (!current?.series) return null;
  const meta = getSeriesMeta(current.series);
  if (!meta) return null;
  const posts = listSeriesPosts(current.series, lang);
  const idx = posts.findIndex((p) => p.slug === slug);
  // `current.series === meta.slug` かつ listSeriesPosts も同 lang を渡しているため、
  // idx は必ず ≥ 0。defensive な `if (idx < 0)` を残すと unreachable branch として
  // coverage が下がるので、`!` assertion で staticAnalysis 側の undefined 表現だけ
  // 抑える (runtime には影響なし)。
  return {
    meta,
    posts,
    currentIndex: idx,
    prev: idx > 0 ? posts[idx - 1]! : null,
    next: idx < posts.length - 1 ? posts[idx + 1]! : null,
  };
}
