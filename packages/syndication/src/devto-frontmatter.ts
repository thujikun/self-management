/**
 * dev.to API `PUT /api/articles/{id}` の body 構築 helper。
 *
 * dev.to は frontmatter YAML を本文先頭に置く形ではなく、API request body の
 * `article` field に各 attribute を JSON で渡す。
 * (https://developers.forem.com/api/v1#tag/articles/operation/updateArticle)
 *
 * 本 module は JSON shape を返す。markdown 本文は **別途 `body_markdown` field**
 * として渡す (pipeline 側で本文と組合せる)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business dev.to API 更新リクエスト body 用の article attribute を Frontmatter から作る pure builder。tags は dev.to の 4 個上限に揃え、canonical_url は ryantsuji.dev/posts/<slug> を SoT として指す
 * @graph-connects content [reads_from] Frontmatter
 */

import type { Frontmatter } from "@self/content";

/**
 * dev.to article attribute (API request body の `article` field の中身)。
 *
 * @graph-connects none
 */
export interface DevtoArticleAttributes {
  title: string;
  published: boolean;
  body_markdown: string;
  description?: string;
  tags: string[];
  canonical_url?: string;
  cover_image?: string;
  series?: string;
}

/** @graph-connects none */
export interface DevtoBuildOptions {
  /** ryantsuji.dev の公開 base (例: `https://ryantsuji.dev`)。canonical_url 構築に使う */
  canonicalHost: string;
  /** 内部 slug (canonical_url 構築に使う) */
  slug: string;
  /** absolute URL of cover image (任意) */
  coverImageUrl?: string;
  /** dev.to series 名 (任意) */
  series?: string;
  /**
   * `syndication.devto.publishAt` を評価する時刻。未指定なら `new Date()`。test 用に
   * 注入できる + CLI 経路で 1 回固定にしてプロセス内で `publishAt` の境界をまたぐ
   * race を防ぐ。
   */
  now?: Date;
}

/**
 * `Frontmatter` + body markdown + options → dev.to article attributes。
 *
 * tags は dev.to の 4 個上限に合わせて先頭 4 件に truncate。
 *
 * @graph-connects content [reads_from] Frontmatter
 */
export function buildDevtoArticle(
  meta: Frontmatter,
  bodyMarkdown: string,
  options: DevtoBuildOptions,
): DevtoArticleAttributes {
  const attrs: DevtoArticleAttributes = {
    title: meta.title,
    published: isPublishedNow(meta, "devto", options.now ?? new Date()),
    body_markdown: bodyMarkdown,
    tags: meta.tags.slice(0, 4),
    canonical_url: `${options.canonicalHost.replace(/\/$/u, "")}/posts/${options.slug}`,
  };
  if (meta.summary) attrs.description = meta.summary;
  if (options.coverImageUrl) attrs.cover_image = options.coverImageUrl;
  if (options.series) attrs.series = options.series;
  return attrs;
}

/**
 * `meta.draft` と `meta.syndication.<target>.publishAt` を合わせて「いま `published:
 * true` にしてよいか」を判定する。draft が立ってる時は常に false、publishAt が
 * 未指定なら `!meta.draft`、publishAt が指定されてる時は `now >= publishAt`。
 *
 * @graph-connects none
 */
export function isPublishedNow(meta: Frontmatter, target: "zenn" | "devto", now: Date): boolean {
  if (meta.draft) return false;
  const publishAt = meta.syndication?.[target]?.publishAt;
  if (!publishAt) return true;
  const t = new Date(publishAt);
  if (Number.isNaN(t.getTime())) return true;
  return t.getTime() <= now.getTime();
}
