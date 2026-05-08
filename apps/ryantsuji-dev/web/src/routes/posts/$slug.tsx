/**
 * `/posts/$slug` — 投稿詳細 page。
 *
 * loader 内で `getPostSource(slug)` → `renderMarkdown(source)` を直接呼び、
 * frontmatter / html / headings / readingTime を返す。
 * 本文は `PostBody` server component に流して `dangerouslySetInnerHTML` で render。
 *
 * 404 (slug 不在) は `notFound()` で 404 レスポンス。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 投稿詳細 route。slug を受け取り renderMarkdown で HTML 化、PostBody に流して描画する。重 dep (shiki / unified) が client bundle に乗らないよう、本格 RSC 化 (createServerFn / renderServerComponent 経由) は次の iteration で扱う
 * @graph-connects tanstack-router [provides] /posts/$slug route
 * @graph-connects content [calls] @self/content の renderMarkdown で source → RenderedDoc 変換
 */

import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { renderMarkdown } from "@self/content";

import { PostBody } from "../../server-components/PostBody.js";
import { getPostSource } from "../../server/posts.js";

/** @graph-connects tanstack-router [provides] /posts/$slug route */
export const Route = createFileRoute("/posts/$slug")({
  loader: async ({ params }) => {
    const source = getPostSource(params.slug);
    if (!source) throw notFound();
    const doc = await renderMarkdown(source);
    return {
      html: doc.html,
      frontmatter: doc.frontmatter,
      headings: doc.headings,
      readingTimeMinutes: doc.readingTimeMinutes,
    };
  },
  component: PostDetail,
});

/** @graph-connects none */
function PostDetail() {
  const { html, frontmatter, headings, readingTimeMinutes } = Route.useLoaderData();
  return (
    <main className="post-detail">
      <nav className="post-detail__crumbs">
        <Link to="/posts">← all posts</Link>
      </nav>
      <header className="post-detail__header">
        <h1>{frontmatter.title}</h1>
        <p className="post-detail__meta">
          <time dateTime={frontmatter.publishedAt}>{frontmatter.publishedAt}</time>
          <span className="post-detail__divider" aria-hidden="true">
            ·
          </span>
          <span>{readingTimeMinutes} min read</span>
          {frontmatter.tags.length > 0 ? (
            <>
              <span className="post-detail__divider" aria-hidden="true">
                ·
              </span>
              <ul className="post-detail__tags">
                {frontmatter.tags.map((tag) => (
                  <li key={tag}>#{tag}</li>
                ))}
              </ul>
            </>
          ) : null}
        </p>
      </header>
      {headings.length > 1 ? (
        <aside className="post-detail__toc" aria-label="目次">
          <h2>目次</h2>
          <ol>
            {headings.map((h) => (
              <li key={h.id} data-level={h.level}>
                <a href={`#${h.id}`}>{h.text}</a>
              </li>
            ))}
          </ol>
        </aside>
      ) : null}
      <PostBody html={html} />
    </main>
  );
}
