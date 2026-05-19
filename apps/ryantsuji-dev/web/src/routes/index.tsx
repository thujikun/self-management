/**
 * `/` — landing page (lang-aware)。
 *
 * 構成:
 * - hero: 大きめ rt logo (logo-full.svg) + name + tagline
 * - latest: 最新 3 post の glass card
 * - syndication note: Zenn / dev.to / GitHub への social row
 *
 * lang は root loader と整合 (cookie / Accept-Language)。copy は EN / JA で別 object に
 * 持って lang で切替。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business トップページ。投稿一覧 (/posts) への入口 + hero + latest 3 post + syndication target。lang は root loader と一貫 (cookie/Accept-Language)、EN/JA でコピー差替え
 * @graph-connects tanstack-router [provides] index route definition
 * @graph-connects content [calls] runLanding 経由で listPosts を呼ぶ
 */

import { Link, createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import type { ReactNode } from "react";

import type { Lang } from "../server/i18n.js";
import { isAdminFromCurrentRequest } from "../server/request.server.js";

import { runLanding } from "./index.server.js";

/**
 * landing server fn: 最新 post + lang を返す。
 *
 * @graph-connects content [calls] runLanding
 */
const landingServer = createServerFn().handler(async ({ context }) => {
  const includeDrafts = await isAdminFromCurrentRequest(context.env);
  return runLanding({ includeDrafts });
});

/** @graph-connects tanstack-router [provides] / route */
export const Route = createFileRoute("/")({
  loader: () => landingServer(),
  component: IndexPage,
  head: () => ({
    links: [
      {
        rel: "preload",
        as: "image",
        href: "/logo-full.svg",
        type: "image/svg+xml",
        fetchPriority: "high",
      },
    ],
  }),
});

/**
 * lang 別 landing copy。EN / JA の 2 言語のみ。
 *
 * @graph-connects none
 */
const COPY: Record<
  Lang,
  {
    taglineLine1: string;
    taglineLine2: string;
    latestHeading: string;
    postsCta: string;
    syndicationNote: (zenn: string, devto: string) => ReactNode;
  }
> = {
  en: {
    taglineLine1: "engineering / design / product",
    taglineLine2:
      "Notes on engineering, design, and product — things I've learned and how I think about them.",
    latestHeading: "latest",
    postsCta: "→ all posts",
    syndicationNote: (zenn, devto) => (
      <>
        Find me on <a href="https://x.com/ryantsuji">X</a> ·{" "}
        <a href="https://github.com/thujikun">GitHub</a> · <a href={zenn}>Zenn</a> (JP) ·{" "}
        <a href={devto}>dev.to</a> (EN)
      </>
    ),
  },
  ja: {
    taglineLine1: "engineering / design / product",
    taglineLine2:
      "エンジニアリング・設計・プロダクトまわりで得た知見や自分の考え方など書いています。",
    latestHeading: "最新の投稿",
    postsCta: "→ 投稿一覧",
    syndicationNote: (zenn, devto) => (
      <>
        <a href="https://x.com/RyanAircloset">X</a> ·{" "}
        <a href="https://github.com/thujikun">GitHub</a> · <a href={zenn}>Zenn</a> ·{" "}
        <a href={devto}>dev.to</a>
      </>
    ),
  },
};

/** @graph-connects none */
function IndexPage() {
  const { lang, latest } = Route.useLoaderData();
  const copy = COPY[lang];
  return (
    <main className="landing">
      <section className="landing__hero">
        <img
          src="/logo-full.svg"
          alt="ryantsuji.dev"
          width={420}
          height={120}
          className="landing__logo"
          fetchPriority="high"
        />
        <p className="landing__tagline">{copy.taglineLine1}</p>
        <p className="landing__bio">{copy.taglineLine2}</p>
        <div className="landing__cta">
          <Link to="/posts" className="landing__cta-button">
            {copy.postsCta}
          </Link>
        </div>
      </section>

      {latest.length > 0 ? (
        <section className="landing__latest">
          <h2 className="landing__latest-heading">{copy.latestHeading}</h2>
          <ul className="landing__latest-list">
            {latest.map((post) => (
              <li key={post.slug} className="landing__latest-item">
                <Link
                  to="/posts/$slug"
                  params={{ slug: post.slug }}
                  className="landing__latest-link"
                >
                  <time className="landing__latest-date" dateTime={post.publishedAt}>
                    {post.publishedAt.slice(0, 10)}
                  </time>
                  <span className="landing__latest-title">{post.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="landing__meta">
        {copy.syndicationNote("https://zenn.dev/thujikun", "https://dev.to/ryantsuji")}
      </p>
    </main>
  );
}
