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
import {
  rewriteImageLinks,
  rewriteInternalLinks,
  type ImageHashResolver,
  type SlugResolver,
} from "./link-rewriter.js";
import { buildZennFrontmatter, stringifyZennFrontmatter } from "./zenn-frontmatter.js";

/** @graph-connects none */
export interface SyndicateForZennArgs {
  meta: Frontmatter;
  body: string;
  /** 内部 link `/posts/<slug>` を Zenn 公開 URL に解決する関数 */
  resolver: SlugResolver;
  /** ryantsuji.dev の base URL (例: `https://ryantsuji.dev`)。`/images/...` 相対 URL
   *  を絶対化するため必要。trailing slash 無し前提。 */
  canonicalHost: string;
  /** 同 slug の英語版が ryantsuji.dev にある場合、その絶対 URL
   *  (例: `https://ryantsuji.dev/posts/<slug>?lang=en`)。null なら header を inject しない。
   *  Zenn は canonical_url を持てない (dev.to のように原典明示できない) ので、JA reader
   *  に英語版の存在を Zenn-only header として伝える役割。 */
  enUrl: string | null;
  /** Zenn 末尾に付加する footer markdown (null なら footer なし) */
  footerMarkdown: string | null;
  /** Zenn 記事 emoji。default `🤖` */
  emoji?: string;
  /** publication_name。null で omit (個人 publish)、default `"aircloset"` */
  publicationName?: string | null;
  /** `syndication.zenn.publishAt` 評価時刻。未指定なら builder 側で `new Date()`。
   *  CLI で loop の外に 1 回 fix して全 post に同一 Date を渡すと、process 内で
   *  publishAt 境界をまたぐ race を防げる。test では境界 freeze 用に注入する。 */
  now?: Date;
  /** `/images/<path>` → 画像 content hash の resolver。指定時は `?v=<hash>` を画像 URL
   *  に付与する (= cache-buster)。Zenn / dev.to の image proxy が source URL を cache
   *  key にするため、PNG だけ更新して URL 同一だと古い画像が返り続ける罠を避ける。 */
  imageHashResolver?: ImageHashResolver;
}

/**
 * Zenn 用 cross-lang header の markdown を組む。`enUrl` が null なら空文字。
 * Zenn の `:::message` callout 構文で記事冒頭 (= greeting より前) に置き、JA reader に
 * 英語版の存在を伝える。dev.to は `canonical_url` で原典 (ryantsuji.dev) を明示できる
 * が、Zenn には同等の機構が無いためこの header で誘導する。
 *
 * @graph-connects none
 */
export function buildZennCrossLangHeader(enUrl: string | null): string {
  if (!enUrl) return "";
  return `:::message\n[English Version is here](${enUrl})\n:::\n\n`;
}

/**
 * Zenn 用に変換。完成 markdown 文字列 (`---\n<zenn fm>\n---\n\n<body>\n`) を返す。
 * 結果をそのまま `<repo>/articles/<id>.md` に書けば Zenn GitHub sync で反映される。
 *
 * @graph-connects content [calls] rewriteInternalLinks / appendFooter / buildZennFrontmatter / stringifyZennFrontmatter
 */
export function syndicateForZenn(args: SyndicateForZennArgs): string {
  const linkRewritten = rewriteInternalLinks(args.body, args.resolver);
  const imageRewritten = rewriteImageLinks(
    linkRewritten,
    args.canonicalHost,
    args.imageHashResolver,
  );
  const withFooter = appendFooter(imageRewritten, args.footerMarkdown);
  const header = buildZennCrossLangHeader(args.enUrl);
  const withHeader = `${header}${withFooter.replace(/^\s+/u, "")}`;
  const fm = buildZennFrontmatter(args.meta, {
    emoji: args.emoji,
    publicationName: args.publicationName,
    now: args.now,
  });
  const fmYaml = stringifyZennFrontmatter(fm);
  return `${fmYaml}\n\n${withHeader}`;
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
  /** `syndication.devto.publishAt` 評価時刻。未指定なら builder 側で `new Date()`。
   *  CLI で loop の外に 1 回 fix して全 post に同一 Date を渡すと、process 内で
   *  publishAt 境界をまたぐ race を防げる。test では境界 freeze 用に注入する。 */
  now?: Date;
  /** `/images/<path>` → 画像 content hash の resolver。指定時は `?v=<hash>` を画像 URL
   *  に付与する。dev.to image optimizer (`media2.dev.to/cdn-cgi/image/...`) は source
   *  URL を cache key にするため、PNG だけ更新で URL 同一だと古い画像が返り続ける罠を
   *  避ける。 */
  imageHashResolver?: ImageHashResolver;
}

/**
 * dev.to API 用に変換。`PUT /api/articles/{id}` の request body の `article` field
 * にそのまま入れられる shape を返す。footer は付加しない (dev.to には footer 不要)。
 *
 * @graph-connects content [calls] rewriteInternalLinks / buildDevtoArticle
 */
export function syndicateForDevto(args: SyndicateForDevtoArgs): DevtoArticleAttributes {
  const linkRewritten = rewriteInternalLinks(args.body, args.resolver);
  const imageRewritten = rewriteImageLinks(
    linkRewritten,
    args.canonicalHost,
    args.imageHashResolver,
  );
  return buildDevtoArticle(args.meta, imageRewritten, {
    canonicalHost: args.canonicalHost,
    slug: args.slug,
    coverImageUrl: args.coverImageUrl,
    series: args.series,
    now: args.now,
  });
}
