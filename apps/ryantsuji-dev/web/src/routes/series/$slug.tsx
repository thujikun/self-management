/**
 * `/series/$slug` — 連載 hub page。
 *
 * 同 series に属する post を `seriesOrder` 昇順で一覧表示する。HN / X 経由で Part N
 * を直接踏んだ読者が Part 1 から読みたい時の入口。`SERIES_REGISTRY` に未登録 slug
 * は 404 を返す (Found: false)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 連載 hub の route。所属 post を Part 順で一覧、HN/X 流入で個別 Part を踏んだ読者が連載 trunk から読み直せる入口を提供。未登録 series slug は 404
 * @graph-connects tanstack-router [provides] /series/$slug route
 * @graph-connects tanstack-start [calls] runListSeriesPosts (server fn) で server-only な lang 解決 + listSeriesPosts を踏む
 */

import { createServerFn } from "@tanstack/react-start";
import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { z } from "zod";

import { runListSeriesPosts } from "./$slug.server.js";

/**
 * `?lang=en|ja` で lang を override。
 *
 * @graph-connects none
 */
const SearchSchema = z.object({
  lang: z.enum(["en", "ja"]).optional(),
});

/**
 * loader を server fn で wrap。`getRequestHeaders` が server runtime 内でしか動か
 * ないため、loader 内で直接呼ばず server fn を挟む。
 *
 * @graph-connects content [calls] runListSeriesPosts
 */
const loadSeriesServer = createServerFn()
  .inputValidator((input: unknown) => {
    const parsed = z
      .object({ slug: z.string().min(1), override: z.enum(["en", "ja"]).optional() })
      .parse(input);
    return parsed;
  })
  .handler(({ data }) => runListSeriesPosts(data.slug, data.override));

/** @graph-connects tanstack-router [provides] /series/$slug route */
export const Route = createFileRoute("/series/$slug")({
  validateSearch: SearchSchema,
  loaderDeps: ({ search }) => ({ override: search.lang }),
  loader: async ({ params, deps }) => {
    const result = await loadSeriesServer({ data: { slug: params.slug, override: deps.override } });
    if (!result.meta) throw notFound();
    return result;
  },
  head: ({ loaderData }) => {
    if (!loaderData?.meta) return {};
    return {
      meta: [
        { title: `${loaderData.meta.title} — ryantsuji.dev` },
        { name: "description", content: loaderData.meta.tagline },
        { property: "og:title", content: loaderData.meta.title },
        { property: "og:description", content: loaderData.meta.tagline },
        { property: "og:url", content: `https://ryantsuji.dev/series/${loaderData.meta.slug}` },
      ],
    };
  },
  component: SeriesHubPage,
});

/** @graph-connects none */
function SeriesHubPage() {
  const { meta, posts, lang } = Route.useLoaderData();
  if (!meta) return null;
  const labelPart = lang === "ja" ? "第" : "Part";
  const labelEmpty = lang === "ja" ? "まだ記事がありません。" : "no posts yet.";
  return (
    <main className="series" lang={lang}>
      <header className="series__header">
        <h1>{meta.title}</h1>
        <p className="series__tagline">{meta.tagline}</p>
      </header>
      <p className="series__count">
        {posts.length} {lang === "ja" ? "本" : posts.length === 1 ? "post" : "posts"}
      </p>
      {posts.length === 0 ? (
        <p>{labelEmpty}</p>
      ) : (
        <ol className="series__list">
          {posts.map((p, i) => {
            const order = p.seriesOrder ?? i + 1;
            return (
              <li key={p.slug} className="series__item">
                <span className="series__item-part">
                  {labelPart} {order}
                  {lang === "ja" ? "回" : ""}
                </span>
                <h2>
                  <Link to="/posts/$slug" params={{ slug: p.slug }}>
                    {p.title}
                  </Link>
                </h2>
                {p.summary ? <p className="series__item-summary">{p.summary}</p> : null}
                <p className="series__item-meta">
                  <time dateTime={p.publishedAt}>{p.publishedAt}</time>
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}
