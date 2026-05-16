/**
 * `/posts` — 投稿一覧 page。
 *
 * loader は **`createServerFn()` 経由** で `listPosts()` を呼ぶ。直接 import すると
 * `server/posts.ts` がぶら下げる `gray-matter` (Node 依存の `Buffer.from`) が client
 * bundle に乗り、SSR は通っても client-side navigation (`/posts/<slug>` の "all
 * posts" リンクで戻る等) 時に `ReferenceError: Buffer is not defined` で落ちる。
 * `createServerFn()` で wrap すれば handler が rsc env に閉じ込められ、client は
 * 結果の JSON だけ受け取る形になる。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 投稿一覧 route。loader で listPosts() を server fn 経由で呼んで PostMeta 配列を取り出し、title + publishedAt + summary + tags の card list を render する。本文 markdown は読まないので一覧は軽い。loader を server fn 化することで gray-matter を client bundle から完全に排除し、client-side navigation でも安全
 * @graph-connects tanstack-router [provides] /posts route
 * @graph-connects tanstack-start [provides] createServerFn で listPosts を rsc env に閉じ込める
 */

import { createServerFn } from "@tanstack/react-start";
import { Link, createFileRoute } from "@tanstack/react-router";

import { listPosts, type PostMeta } from "../../server/posts.js";

/**
 * server function: 投稿一覧 meta を返す。`server/posts.ts` (gray-matter 含む) を
 * client bundle から完全に切り離す目的で wrap。
 *
 * @graph-connects content [calls] listPosts で frontmatter を読み出す
 */
const listPostsServer = createServerFn().handler(async (): Promise<PostMeta[]> => {
  return listPosts();
});

/** @graph-connects tanstack-router [provides] /posts route */
export const Route = createFileRoute("/posts/")({
  loader: async () => ({ posts: await listPostsServer() }),
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
