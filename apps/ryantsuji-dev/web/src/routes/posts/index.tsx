/**
 * `/posts` — 投稿一覧 page (en/ja 多言語対応)。
 *
 * loader は `createServerFn()` で wrap した `runListPosts` を呼び、server で
 * `Accept-Language` から優先 lang を決定 (`?lang=` query で override 可)。dedupe は
 * slug 単位、要求 lang variant が無い post は en fallback で表示 (badge で
 * `JP only` / `EN+JP` 等を示す)。
 *
 * 直接 `listPosts` を import すると gray-matter が client bundle に乗るため、
 * server fn の handler 経由でしか触らない。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 投稿一覧 route (en/ja 多言語対応)。Accept-Language から優先 lang を決め、slug 単位で dedupe した card list を render。各 card には available lang バッジを付け、user が toggle で言語を切替えられるよう `?lang=ja` 等の link を提供する。server fn で gray-matter を rsc env に閉じ込め、client bundle 軽量化も維持
 * @graph-connects tanstack-router [provides] /posts route
 * @graph-connects tanstack-start [provides] createServerFn で listPosts を rsc env に閉じ込める
 */

import { createServerFn } from "@tanstack/react-start";
import { Link, createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { displayTags } from "../../lib/tags.js";
import { runListPosts } from "./index.server.js";
import type { Lang } from "../../server/i18n.js";
import type { PostListItem } from "../../server/posts.js";

/**
 * `?lang=en|ja` で lang を override (cookie に persist)、`?tag=<tag>` で listing を
 * filter。invalid 値は捨てる。
 *
 * @graph-connects none
 */
const SearchSchema = z.object({
  lang: z.enum(["en", "ja"]).optional(),
  tag: z.string().min(1).max(50).optional(),
});

/**
 * server function: 投稿一覧 meta を返す。input の override (?lang=) と ?tag= を
 * 受け、server 側で cookie / Accept-Language と合わせて lang を確定し、tag で filter する。
 *
 * @graph-connects content [calls] runListPosts → listPosts
 */
/** @graph-connects none */
const ListPostsInputSchema = z.object({
  override: z.enum(["en", "ja"]).optional(),
  tag: z.string().optional(),
});
/** @graph-connects content [calls] runListPosts → listPosts */
const listPostsServer = createServerFn()
  .inputValidator((data: unknown) => ListPostsInputSchema.parse(data))
  .handler(async ({ data }) => runListPosts(data.override, data.tag));

/** @graph-connects tanstack-router [provides] /posts route */
export const Route = createFileRoute("/posts/")({
  validateSearch: SearchSchema,
  loaderDeps: ({ search }) => ({ override: search.lang, tag: search.tag }),
  loader: async ({ deps }) => listPostsServer({ data: { override: deps.override, tag: deps.tag } }),
  component: PostsIndex,
});

/** @graph-connects none */
function PostsIndex() {
  const { lang, posts, tag } = Route.useLoaderData();
  return (
    <main className="posts-index">
      <header className="posts-index__header">
        <h1>posts</h1>
        <p className="meta">
          source-of-truth for posts syndicated to <a href="https://zenn.dev/thujikun">Zenn</a> (JP)
          and <a href="https://dev.to/ryantsuji">dev.to</a> (EN).
        </p>
        {tag ? (
          <p className="posts-index__filter">
            filtered by <strong>#{tag}</strong>{" "}
            <Link to="/posts" className="posts-index__filter-clear">
              clear
            </Link>
          </p>
        ) : null}
      </header>
      <ul className="post-card-list">
        {posts.map((post) => (
          <PostCard key={post.slug} post={post} requestedLang={lang} />
        ))}
      </ul>
    </main>
  );
}

/**
 * 一覧 card 1 枚。要求 lang と実 serve lang が違う (= fallback) 場合は
 * `(showing EN — JP not available)` の hint を出す。`_` prefix slug は listing 段階で
 * 除外されるため、ja-only / en-only fallback hint の view-level test は本 component を
 * 直接 render する単体テストで担保する。
 *
 * @graph-connects tanstack-router [calls] Link で /posts/$slug に navigate
 */
export function PostCard({ post, requestedLang }: { post: PostListItem; requestedLang: Lang }) {
  const isFallback = post.servedLang !== requestedLang;
  const tags = displayTags(post.tags);
  return (
    <li className="post-card">
      <Link to="/posts/$slug" params={{ slug: post.slug }} className="post-card__link">
        <time className="post-card__date" dateTime={post.publishedAt}>
          {post.publishedAt}
        </time>
        <h2 className="post-card__title">{post.title}</h2>
        {post.summary ? <p className="post-card__summary">{post.summary}</p> : null}
        <ul className="post-card__langs" aria-label="available languages">
          {post.availableLangs.map((l) => (
            <li
              key={l}
              className={
                l === post.servedLang
                  ? "post-card__lang post-card__lang--served"
                  : "post-card__lang"
              }
            >
              {l.toUpperCase()}
            </li>
          ))}
        </ul>
        {isFallback ? (
          <p className="post-card__fallback-note" lang={post.servedLang}>
            (showing {post.servedLang.toUpperCase()} — {requestedLang.toUpperCase()} not available)
          </p>
        ) : null}
      </Link>
      {/* tags は card 全体 Link の外に置いて、tag click で `/posts?tag=` 移動できるよう
          にする (nested Link を避ける目的)。 */}
      {tags.length > 0 ? (
        <ul className="post-card__tags">
          {tags.map((tag) => (
            <li key={tag} className="post-card__tag">
              <Link to="/posts" search={{ tag }}>
                #{tag}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
