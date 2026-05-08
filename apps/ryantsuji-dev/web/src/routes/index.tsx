/**
 * `/` — placeholder landing page。
 *
 * Phase 1 (design discovery) で実 design を流し込むまでの仮 shell。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business トップページ placeholder。design discovery と記事 rendering 実装までは "ryantsuji.dev / coming soon" だけ表示し、deploy パイプラインの動作確認に専念する
 * @graph-connects tanstack-router [provides] index route definition
 */

import { createFileRoute } from "@tanstack/react-router";

/** @graph-connects tanstack-router [provides] / route */
export const Route = createFileRoute("/")({
  component: IndexPage,
});

/** @graph-connects none */
function IndexPage() {
  return (
    <main className="landing">
      <h1>ryantsuji.dev</h1>
      <p>coming soon — engineering / design / product writings.</p>
      <p className="meta">
        source-of-truth for posts syndicated to{" "}
        <a href="https://zenn.dev/ryantsuji">Zenn</a> (JP) and{" "}
        <a href="https://dev.to/ryantsuji">dev.to</a> (EN).
      </p>
    </main>
  );
}
