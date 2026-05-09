/**
 * `/posts/$slug` — 投稿詳細 page。
 *
 * `renderPostServer` は **createServerFn handler 内で renderMarkdown を呼ぶ** ので、
 * shiki / unified / @shikijs/rehype は build 時に rsc env だけに bundle される
 * (client / ssr env には漏れない)。client は handler の戻り値 (構造化 JSON) のみ
 * を受け取り、PostBody は dangerouslySetInnerHTML で済ます。
 *
 * 404 (slug 不在 or draft) は `notFound()` で boundary に倒す。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 投稿詳細 route。createServerFn の handler 内で renderMarkdown を実行することで、shiki / unified の重 dep を rsc env のみに bundle して client / ssr bundle から閉じ出す。loader はその handler の戻り値 (frontmatter / html / headings / readingTime) を受け取って PostBody に流す
 * @graph-connects tanstack-router [provides] /posts/$slug route
 * @graph-connects tanstack-start [provides] createServerFn で renderMarkdown を rsc env に閉じ込める
 * @graph-connects content [calls] @self/content の renderMarkdown で source → RenderedDoc 変換 (server-only)
 */

import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { renderMarkdown } from "@self/content";
import { z } from "zod";

import { PostBody } from "../../server-components/PostBody.js";
import { getPostSource } from "../../server/posts.js";

/** @graph-connects none */
const SlugSchema = z.string().min(1);

/**
 * server function: slug → markdown source 取得 → renderMarkdown で render し、
 * frontmatter / html / headings / readingTime を返す。本関数の handler 内のみで
 * `@self/content` を import しているので、shiki / unified は rsc env だけに bundle
 * される。
 *
 * @graph-connects content [calls] renderMarkdown(source) で構造化 RenderedDoc に変換
 */
const renderPostServer = createServerFn()
  .inputValidator((data: unknown) => SlugSchema.parse(data))
  .handler(async ({ data: slug }) => {
    const source = getPostSource(slug);
    if (!source) throw notFound();
    const doc = await renderMarkdown(source);
    return {
      html: doc.html,
      frontmatter: doc.frontmatter,
      headings: doc.headings,
      readingTimeMinutes: doc.readingTimeMinutes,
    };
  });

/** @graph-connects tanstack-router [provides] /posts/$slug route */
export const Route = createFileRoute("/posts/$slug")({
  loader: ({ params }) => renderPostServer({ data: params.slug }),
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
