/**
 * syndication pipeline composer。各 transform を target 別に組み合わせ、
 * 「ryantsuji.dev の原稿」→「target に publish できる成果物」を返す。
 *
 * input は **gray-matter で分離済の `meta` + `body`** で受け取る (本 module は
 * markdown parse を持たない)。CLI 層が `content/posts/<slug>.<lang>.md` を読んで
 * gray-matter で分離 → pipeline に渡す。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 各 transform (link rewrite / footer append / frontmatter builder) を target ごとに順に compose する pure pipeline。Zenn は完成 markdown 文字列、dev.to は API 用 article attribute object を返す。markdown parse / file I/O / API 呼び出しは本 module 外
 * @graph-connects content [reads_from] @self/content の Frontmatter を入力に取る
 */

import type { Frontmatter } from "@self/content";

import { appendFooter } from "./footer.js";
import { buildDevtoArticle, type DevtoArticleAttributes } from "./devto-frontmatter.js";
import { rewriteInternalLinks, type SlugResolver } from "./link-rewriter.js";
import { buildZennFrontmatter, stringifyZennFrontmatter } from "./zenn-frontmatter.js";

/** @graph-connects none */
export interface SyndicateForZennArgs {
  meta: Frontmatter;
  body: string;
  /** 内部 link `/posts/<slug>` を Zenn 公開 URL に解決する関数 */
  resolver: SlugResolver;
  /** Zenn 末尾に付加する footer markdown (null なら footer なし) */
  footerMarkdown: string | null;
  /** Zenn 記事 emoji。default `🤖` */
  emoji?: string;
  /** publication_name。null で omit (個人 publish)、default `"aircloset"` */
  publicationName?: string | null;
}

/**
 * Zenn 用に変換。完成 markdown 文字列 (`---\n<zenn fm>\n---\n\n<body>\n`) を返す。
 * 結果をそのまま `<repo>/articles/<id>.md` に書けば Zenn GitHub sync で反映される。
 *
 * @graph-connects content [calls] rewriteInternalLinks / appendFooter / buildZennFrontmatter / stringifyZennFrontmatter
 */
export function syndicateForZenn(args: SyndicateForZennArgs): string {
  const rewritten = rewriteInternalLinks(args.body, args.resolver);
  const withFooter = appendFooter(rewritten, args.footerMarkdown);
  const fm = buildZennFrontmatter(args.meta, {
    emoji: args.emoji,
    publicationName: args.publicationName,
  });
  const fmYaml = stringifyZennFrontmatter(fm);
  return `${fmYaml}\n\n${withFooter.replace(/^\s+/u, "")}`;
}

/** @graph-connects none */
export interface SyndicateForDevtoArgs {
  meta: Frontmatter;
  body: string;
  /** ryantsuji.dev の internal slug (canonical_url 構築用) */
  slug: string;
  /** 内部 link `/posts/<slug>` を dev.to 公開 URL に解決する関数 */
  resolver: SlugResolver;
  /** ryantsuji.dev の base URL (例: `https://ryantsuji.dev`) */
  canonicalHost: string;
  /** absolute URL of cover image (frontmatter `cover` を canonicalHost と組合せた値) */
  coverImageUrl?: string;
  /** dev.to series 名 */
  series?: string;
}

/**
 * dev.to API 用に変換。`PUT /api/articles/{id}` の request body の `article` field
 * にそのまま入れられる shape を返す。footer は付加しない (dev.to には footer 不要)。
 *
 * @graph-connects content [calls] rewriteInternalLinks / buildDevtoArticle
 */
export function syndicateForDevto(args: SyndicateForDevtoArgs): DevtoArticleAttributes {
  const rewritten = rewriteInternalLinks(args.body, args.resolver);
  return buildDevtoArticle(args.meta, rewritten, {
    canonicalHost: args.canonicalHost,
    slug: args.slug,
    coverImageUrl: args.coverImageUrl,
    series: args.series,
  });
}
