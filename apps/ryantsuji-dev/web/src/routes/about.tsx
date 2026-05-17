/**
 * `/about` — author profile page。
 *
 * HN / X 流入の初訪読者が「誰が書いてるか」を確認する canonical 入口。会社ロゴは
 * 出さない (個人ブログとしてのアイデンティティ優先) が、所属 (airCloset, Inc. CTO)
 * は明示してプロフェッショナルな文脈を立てる。実績は過去の主要連載・各種プラット
 * フォームへのリンクで「強い個人」として可視化する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 著者プロフィール page。HN / X 経由で初訪する読者向けに 1 枚で bio + 所属 + 連絡経路 + 主要過去記事を提示し、信頼度と連続購読動機を作る入口。会社色を控えて個人色を優先する設計
 * @graph-connects tanstack-router [provides] /about route
 */

import { Link, createFileRoute } from "@tanstack/react-router";

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
function AboutPage() {
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
          <p className="about__tagline">
            CTO at{" "}
            <a href="https://corp.air-closet.com/" rel="noopener noreferrer">
              airCloset, Inc.
            </a>
            . Building <strong>cortex</strong>, our AI-first dev platform where AI handles the
            review, fix, deploy, and incident-response loops.
          </p>
        </div>
      </header>

      <section className="about__section">
        <h2>What I write about</h2>
        <p>
          Notes on <strong>harness engineering</strong> — the systems around AI agents that decide
          whether they ship or just demo. Most posts are field notes from building cortex in
          production: Auto Review, Self-Healing Ops, Product Graph, MCP servers, Agentic Graph RAG.
        </p>
        <p>
          Series in progress:{" "}
          <Link to="/series/$slug" params={{ slug: "building-ai-harness" }}>
            Building AI Harness
          </Link>
          .
        </p>
      </section>

      <section className="about__section">
        <h2>Recent posts</h2>
        <ul className="about__post-list">
          <li>
            <Link to="/posts/$slug" params={{ slug: "ai-harness-intro" }}>
              Building a Real AI Harness — Series Intro
            </Link>{" "}
            <span className="about__post-meta">— how cortex auto-reviews PRs, self-heals ops</span>
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
        <p>
          Full archive: <Link to="/posts">/posts</Link>.
        </p>
      </section>

      <section className="about__section">
        <h2>Elsewhere</h2>
        <ul className="about__links">
          <li>
            <a href="https://x.com/ryantsuji" rel="noopener noreferrer">
              X (EN)
            </a>{" "}
            ·{" "}
            <a href="https://x.com/RyanAircloset" rel="noopener noreferrer">
              X (JP, airCloset 公式)
            </a>
          </li>
          <li>
            <a href="https://github.com/thujikun" rel="noopener noreferrer">
              GitHub
            </a>
          </li>
          <li>
            <a href="https://dev.to/ryantsuji" rel="noopener noreferrer">
              dev.to (EN syndication)
            </a>{" "}
            ·{" "}
            <a href="https://zenn.dev/aircloset" rel="noopener noreferrer">
              Zenn (JP syndication via airCloset publication)
            </a>
          </li>
          <li>
            <a href="https://www.linkedin.com/in/ryan-tsuji/" rel="noopener noreferrer">
              LinkedIn
            </a>
          </li>
          <li>
            Email: <a href="mailto:hello@ryantsuji.dev">hello@ryantsuji.dev</a>
          </li>
          <li>
            Subscribe: <a href="/rss/en.xml">RSS (EN)</a> · <a href="/rss/ja.xml">RSS (JP)</a>
          </li>
        </ul>
      </section>

      <p className="about__nav">
        <Link to="/">← back to home</Link>
      </p>
    </main>
  );
}
