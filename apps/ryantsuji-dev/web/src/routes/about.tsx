/**
 * `/about` — author profile page。
 *
 * HN / X 流入の初訪読者が「誰が書いてるか」を確認する canonical 入口。会社ロゴは
 * 出さない (個人ブログとしてのアイデンティティ優先) が、所属 (airCloset, Inc. CTO)
 * は明示してプロフェッショナルな文脈を立てる。実績は過去の主要連載・各種プラット
 * フォームへのリンクで「強い個人」として可視化する。
 *
 * lang は root loader (`runResolveLang`) が確定したものを `getRouteApi("__root__")`
 * 経由で取り、EN / JA で copy を分岐する。lang switcher で切替えた瞬間に
 * `router.invalidate()` が走り loader 再評価で反映される。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 著者プロフィール page。HN / X 経由で初訪する読者向けに 1 枚で bio + 所属 + 連絡経路 + 主要過去記事を提示し、信頼度と連続購読動機を作る入口。EN / JA で copy を分岐し、cortex / airCloset / slug 等の固有名は両 lang で同一表記
 * @graph-connects tanstack-router [provides] /about route
 */

import { Link, createFileRoute, getRouteApi } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { Lang } from "../server/i18n.js";

/** @graph-connects tanstack-router [provides] /about route */
export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About — ryantsuji.dev" },
      {
        name: "description",
        content:
          "Ryan Tsuji — CTO at airCloset, Inc. Building cortex, an AI-first dev platform where AI does the heavy lifting. Notes on harness engineering, Graph RAG, and MCPs.",
      },
      { property: "og:title", content: "About — ryantsuji.dev" },
      {
        property: "og:description",
        content:
          "Ryan Tsuji — CTO at airCloset, Inc. Notes on harness engineering, Graph RAG, and MCPs.",
      },
      { property: "og:url", content: "https://ryantsuji.dev/about" },
      { property: "og:image", content: "https://ryantsuji.dev/avatar.jpg" },
    ],
  }),
  component: AboutPage,
});

/** @graph-connects none */
const rootApi = getRouteApi("__root__");

/**
 * lang 別の表示 copy。固有名 (cortex / airCloset / slug 等) は両 lang で同一
 * 表記で維持し、文中の説明部分のみ JA / EN で分岐する。
 *
 * @graph-connects none
 */
const COPY: Record<
  Lang,
  {
    taglineNode: ReactNode;
    writeHeading: string;
    writeBody1: ReactNode;
    writeBody2: ReactNode;
    recentHeading: string;
    recentItem1Meta: string;
    fullArchive: ReactNode;
    elsewhereHeading: string;
    xEnLabel: string;
    xJaLabel: string;
    devtoLabel: string;
    zennLabel: string;
    emailLabel: string;
    subscribeLabel: string;
    backToHome: string;
  }
> = {
  en: {
    taglineNode: (
      <>
        CTO at{" "}
        <a href="https://corp.air-closet.com/" target="_blank" rel="noopener noreferrer">
          airCloset, Inc.
        </a>
        . Building <strong>cortex</strong>, our AI-first dev platform where AI handles the review,
        fix, deploy, and incident-response loops.
      </>
    ),
    writeHeading: "What I write about",
    writeBody1: (
      <>
        Notes on <strong>harness engineering</strong> — the systems around AI agents that decide
        whether they ship or just demo. Most posts are field notes from building cortex in
        production: Auto Review, Self-Healing Ops, Product Graph, MCP servers, Agentic Graph RAG.
      </>
    ),
    writeBody2: (
      <>
        Series in progress:{" "}
        <Link to="/series/$slug" params={{ slug: "building-ai-harness" }}>
          Building AI Harness
        </Link>
        .
      </>
    ),
    recentHeading: "Recent posts",
    recentItem1Meta: "— how cortex auto-reviews PRs, self-heals ops",
    fullArchive: (
      <>
        Full archive: <Link to="/posts">/posts</Link>.
      </>
    ),
    elsewhereHeading: "Elsewhere",
    xEnLabel: "X (EN)",
    xJaLabel: "X (JP, airCloset 公式)",
    devtoLabel: "dev.to (EN syndication)",
    zennLabel: "Zenn (JP syndication via airCloset publication)",
    emailLabel: "Email",
    subscribeLabel: "Subscribe",
    backToHome: "← back to home",
  },
  ja: {
    taglineNode: (
      <>
        <a href="https://corp.air-closet.com/" target="_blank" rel="noopener noreferrer">
          airCloset, Inc.
        </a>
        の CTO。<strong>cortex</strong>という AI 中心の開発プラットフォームを作っていて、
        コードレビュー・修正・デプロイ・障害対応のループを AI に任せています。
      </>
    ),
    writeHeading: "書いていること",
    writeBody1: (
      <>
        AI エージェントが「実際に出荷できる」か「デモで終わる」かを決める、 まわりの仕組み ={" "}
        <strong>ハーネスエンジニアリング</strong>の実装ノート。 ほとんどの投稿は cortex
        を本番で動かしている中で出てきたフィールドノートで、 Auto Review、Self-Healing Ops、Product
        Graph、MCP サーバ、Agentic Graph RAG などを扱います。
      </>
    ),
    writeBody2: (
      <>
        連載中:{" "}
        <Link to="/series/$slug" params={{ slug: "building-ai-harness" }}>
          AI ハーネスを徹底的に整える
        </Link>
        。
      </>
    ),
    recentHeading: "最近の投稿",
    recentItem1Meta: "— cortex が PR を自動レビューし、運用を自動修復する話",
    fullArchive: (
      <>
        全記事一覧: <Link to="/posts">/posts</Link>。
      </>
    ),
    elsewhereHeading: "ほかの場所",
    xEnLabel: "X (EN)",
    xJaLabel: "X (JP, airCloset 公式)",
    devtoLabel: "dev.to (EN syndicate)",
    zennLabel: "Zenn (JP syndicate / airCloset publication)",
    emailLabel: "メール",
    subscribeLabel: "購読",
    backToHome: "← ホームに戻る",
  },
};

/** @graph-connects none */
function AboutPage() {
  const { lang } = rootApi.useLoaderData();
  const copy = COPY[lang];
  return (
    <main className="about">
      <header className="about__header">
        <img
          src="/avatar.jpg"
          alt="Ryan Tsuji"
          width={160}
          height={160}
          className="about__avatar"
        />
        <div className="about__intro">
          <h1>Ryan Tsuji / 辻</h1>
          <p className="about__tagline">{copy.taglineNode}</p>
        </div>
      </header>

      <section className="about__section">
        <h2>{copy.writeHeading}</h2>
        <p>{copy.writeBody1}</p>
        <p>{copy.writeBody2}</p>
      </section>

      <section className="about__section">
        <h2>{copy.recentHeading}</h2>
        <ul className="about__post-list">
          <li>
            <Link to="/posts/$slug" params={{ slug: "ai-harness-intro" }}>
              Building a Real AI Harness — Series Intro
            </Link>{" "}
            <span className="about__post-meta">{copy.recentItem1Meta}</span>
          </li>
          <li>
            <Link to="/posts/$slug" params={{ slug: "agentic-graph-rag-mcp" }}>
              Graph RAG Isn&apos;t a One-Shot Anymore — Agentic Graph RAG MCPs
            </Link>
          </li>
          <li>
            <Link to="/posts/$slug" params={{ slug: "mcp-parking-pattern" }}>
              Cutting Self-Built MCP Server Token Usage by 90% — The Parking Pattern
            </Link>
          </li>
          <li>
            <Link to="/posts/$slug" params={{ slug: "17-mcp-servers" }}>
              Opening Internal Ops to AI — 17 In-House MCP Servers
            </Link>
          </li>
          <li>
            <Link to="/posts/$slug" params={{ slug: "db-graph-mcp" }}>
              DB Graph MCP — Cross-DB Natural-Language Search via Graph RAG
            </Link>
          </li>
        </ul>
        <p>{copy.fullArchive}</p>
      </section>

      <section className="about__section">
        <h2>{copy.elsewhereHeading}</h2>
        <ul className="about__links">
          <li>
            <a href="https://x.com/ryantsuji" target="_blank" rel="noopener noreferrer">
              {copy.xEnLabel}
            </a>{" "}
            ·{" "}
            <a href="https://x.com/RyanAircloset" target="_blank" rel="noopener noreferrer">
              {copy.xJaLabel}
            </a>
          </li>
          <li>
            <a href="https://github.com/thujikun" target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
          </li>
          <li>
            <a href="https://dev.to/ryantsuji" target="_blank" rel="noopener noreferrer">
              {copy.devtoLabel}
            </a>{" "}
            ·{" "}
            <a href="https://zenn.dev/aircloset" target="_blank" rel="noopener noreferrer">
              {copy.zennLabel}
            </a>
          </li>
          <li>
            <a
              href="https://www.linkedin.com/in/ryosuketsuji/"
              target="_blank"
              rel="noopener noreferrer"
            >
              LinkedIn
            </a>
          </li>
          <li>
            {copy.emailLabel}: <a href="mailto:hello@ryantsuji.dev">hello@ryantsuji.dev</a>
          </li>
          <li>
            {copy.subscribeLabel}:{" "}
            <a href="/rss/en.xml" target="_blank" rel="noopener">
              RSS (EN)
            </a>{" "}
            ·{" "}
            <a href="/rss/ja.xml" target="_blank" rel="noopener">
              RSS (JP)
            </a>
          </li>
        </ul>
      </section>

      <p className="about__nav">
        <Link to="/">{copy.backToHome}</Link>
      </p>
    </main>
  );
}
