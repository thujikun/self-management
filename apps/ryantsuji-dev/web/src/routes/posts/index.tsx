/**
 * `/posts` — 投稿一覧 page。
 *
 * loader 内で `listPosts()` を直接呼び、本文は読まずに meta だけ返す。
 * SSR 時のみ `import.meta.glob` の inline 結果が解決され、client への hydration
 * では loader 結果 (PostMeta[]) だけが流れるので軽量。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 投稿一覧 route。loader で listPosts() を呼んで PostMeta 配列を取り出し、title + publishedAt + summary + tags の card list を render する。本文 markdown は読まないので一覧は軽い
 * @graph-connects tanstack-router [provides] /posts route
 */

import { Link, createFileRoute } from "@tanstack/react-router";

import { listPosts } from "../../server/posts.js";

/** @graph-connects tanstack-router [provides] /posts route */
export const Route = createFileRoute("/posts/")({
  loader: () => ({ posts: listPosts() }),
  component: PostsIndex,
});

/** @graph-connects none */
function PostsIndex() {
  const { posts } = Route.useLoaderData();
  return (
    <main className="posts-index">
      <header className="posts-index__header">
        <h1>posts</h1>
        <p className="meta">
          source-of-truth for posts syndicated to <a href="https://zenn.dev/ryantsuji">Zenn</a> (JP)
          and <a href="https://dev.to/ryantsuji">dev.to</a> (EN).
        </p>
      </header>
      <ul className="post-card-list">
        {posts.map((post) => (
          <li key={post.slug} className="post-card">
            <Link to="/posts/$slug" params={{ slug: post.slug }} className="post-card__link">
              <time className="post-card__date" dateTime={post.publishedAt}>
                {post.publishedAt}
              </time>
              <h2 className="post-card__title">{post.title}</h2>
              {post.summary ? <p className="post-card__summary">{post.summary}</p> : null}
              {post.tags.length > 0 ? (
                <ul className="post-card__tags">
                  {post.tags.map((tag) => (
                    <li key={tag} className="post-card__tag">
                      #{tag}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
