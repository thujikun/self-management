/**
 * `/` — landing page。
 *
 * `/posts` への入口を兼ねる minimal landing。design tokens を流し込んで type
 * scale + accent color の確認も兼ねる。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business トップページ。投稿一覧 (/posts) への入口 + syndication target (Zenn/dev.to) のリンク。design tokens 適用後の最初の page として visual の health check 場所も兼ねる
 * @graph-connects tanstack-router [provides] index route definition
 */

import { Link, createFileRoute } from "@tanstack/react-router";

/** @graph-connects tanstack-router [provides] / route */
export const Route = createFileRoute("/")({
  component: IndexPage,
});

/** @graph-connects none */
function IndexPage() {
  return (
    <main className="landing">
      <h1>ryantsuji.dev</h1>
      <p>engineering / design / product writings — by Ryan Tsuji.</p>
      <p>
        <Link to="/posts">→ all posts</Link>
      </p>
      <p className="meta">
        source-of-truth for posts syndicated to <a href="https://zenn.dev/ryantsuji">Zenn</a> (JP)
        and <a href="https://dev.to/ryantsuji">dev.to</a> (EN).
      </p>
    </main>
  );
}
