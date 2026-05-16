/**
 * PostSharePane の SSR test。
 *
 * - buildXShareUrl / buildFacebookShareUrl の URL 構築
 * - 認証あり (likes 提供) → like button + share buttons + RSS link を render
 * - 認証なし (likes=null + signInHref) → like の代わりに sign-in Link
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business PostSharePane の SSR markup + share URL 構築 の網羅
 * @graph-connects none
 */

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { buildFacebookShareUrl, buildXShareUrl, PostSharePane } from "./PostSharePane.js";

describe("buildXShareUrl", () => {
  it("EN は via=ryantsuji + 順序固定 (text, url, via) の query で組む", () => {
    expect(buildXShareUrl("Hello", "https://ryantsuji.dev/posts/x", "en")).toBe(
      "https://x.com/intent/post?text=Hello&url=https%3A%2F%2Fryantsuji.dev%2Fposts%2Fx&via=ryantsuji",
    );
  });

  it("JA は via=RyanAircloset", () => {
    expect(buildXShareUrl("こん", "https://ryantsuji.dev/posts/x?lang=ja", "ja")).toContain(
      "via=RyanAircloset",
    );
  });

  it("title / URL の特殊文字を URI encode する", () => {
    const url = buildXShareUrl("a & b", "https://x.test/?q=1", "en");
    expect(url).toContain("text=a+%26+b");
    expect(url).toContain("url=https%3A%2F%2Fx.test%2F%3Fq%3D1");
  });
});

describe("buildFacebookShareUrl", () => {
  it("u= に URL を encode して入れる", () => {
    expect(buildFacebookShareUrl("https://ryantsuji.dev/posts/x")).toBe(
      "https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fryantsuji.dev%2Fposts%2Fx",
    );
  });
});

function ssr(element: React.ReactElement): string {
  // PostSharePane は router context を要求しない (Link 不使用、sign-in fallback も
  // plain <a href>) ため、そのまま renderToString で OK。
  return renderToString(element);
}

describe("PostSharePane SSR", () => {
  it("認証済み + liked=false → like button + share buttons + RSS link", () => {
    const html = ssr(
      <PostSharePane
        slug="hello"
        title="Hello"
        lang="en"
        postUrl="https://ryantsuji.dev/posts/hello"
        likes={{ count: 3, liked: false }}
        onLike={() => {}}
      />,
    );
    expect(html).toMatch(/post-share-pane__btn--like/);
    expect(html).toMatch(/aria-pressed="false"/);
    expect(html).toMatch(/post-share-pane__count">3</);
    expect(html).toMatch(/post-share-pane__btn--x/);
    expect(html).toMatch(/post-share-pane__btn--facebook/);
    expect(html).toMatch(/href="\/rss\/en\.xml"/);
  });

  it("liked=true → aria-pressed=true + ♥", () => {
    const html = ssr(
      <PostSharePane
        slug="x"
        title="x"
        lang="en"
        postUrl="https://x"
        likes={{ count: 1, liked: true }}
      />,
    );
    expect(html).toMatch(/aria-pressed="true"/);
    expect(html).toMatch(/♥/);
  });

  it("likes=null + signInHref → sign-in Link fallback、like button は出さない", () => {
    const html = ssr(
      <PostSharePane
        slug="x"
        title="x"
        lang="en"
        postUrl="https://x"
        likes={null}
        signInHref="/posts/x"
      />,
    );
    expect(html).toMatch(/post-share-pane__btn--signin/);
    expect(html).not.toMatch(/post-share-pane__btn--like/);
  });

  it("likes=null + signInHref なし → like の代替も出さない (defensive)", () => {
    const html = ssr(
      <PostSharePane slug="x" title="x" lang="en" postUrl="https://x" likes={null} />,
    );
    expect(html).not.toMatch(/post-share-pane__btn--like/);
    expect(html).not.toMatch(/post-share-pane__btn--signin/);
  });

  it("lang=ja は RSS link が /rss/ja.xml に", () => {
    const html = ssr(
      <PostSharePane
        slug="x"
        title="x"
        lang="ja"
        postUrl="https://x?lang=ja"
        likes={{ count: 0, liked: false }}
      />,
    );
    expect(html).toMatch(/href="\/rss\/ja\.xml"/);
  });
});
