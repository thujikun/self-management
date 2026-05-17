/**
 * `rewriteInternalLinks` の分岐網羅テスト。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 内部 link 書き換え transformer の境界 test。resolver hit / miss、fragment / query 保持、複数 link の一括変換、無関係な markdown link は touch しないことを保証
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import { rewriteImageLinks, rewriteInternalLinks } from "./link-rewriter.js";

const MAP: Record<string, string> = {
  "db-graph-mcp": "https://zenn.dev/aircloset/articles/2731787582881a",
  "17-mcp-servers": "https://zenn.dev/aircloset/articles/d9fc317c1336c2",
};
const resolver = (slug: string): string | null => MAP[slug] ?? null;

describe("rewriteInternalLinks", () => {
  it("単純な /posts/<slug> 形式を resolver 経由で置換", () => {
    const out = rewriteInternalLinks("前回の [DB Graph MCP](/posts/db-graph-mcp) を参照", resolver);
    expect(out).toBe(
      "前回の [DB Graph MCP](https://zenn.dev/aircloset/articles/2731787582881a) を参照",
    );
  });

  it("fragment (#section) を保持", () => {
    const out = rewriteInternalLinks(
      "[詳細](/posts/db-graph-mcp#mcp-server-design) を参照",
      resolver,
    );
    expect(out).toContain("https://zenn.dev/aircloset/articles/2731787582881a#mcp-server-design");
  });

  it("query (?lang=ja) を保持", () => {
    const out = rewriteInternalLinks("[ja](/posts/db-graph-mcp?lang=ja)", resolver);
    expect(out).toContain("https://zenn.dev/aircloset/articles/2731787582881a?lang=ja");
  });

  it("resolver が null を返した slug は link をそのまま残す", () => {
    const out = rewriteInternalLinks("[未配信記事](/posts/unknown-slug) を参照", resolver);
    expect(out).toBe("[未配信記事](/posts/unknown-slug) を参照");
  });

  it("複数 link を一括で置換", () => {
    const input =
      "[A](/posts/db-graph-mcp)、[B](/posts/17-mcp-servers)、[C](/posts/missing) の 3 つ";
    const out = rewriteInternalLinks(input, resolver);
    expect(out).toContain("https://zenn.dev/aircloset/articles/2731787582881a");
    expect(out).toContain("https://zenn.dev/aircloset/articles/d9fc317c1336c2");
    expect(out).toContain("/posts/missing"); // 未配信は残る
  });

  it("外部 URL link は touch しない", () => {
    const input = "[X](https://example.com/posts/abc) を参照";
    expect(rewriteInternalLinks(input, resolver)).toBe(input);
  });

  it("画像 alt の `[!...]` パターンに似ていても `/posts/` で始まらないなら touch しない", () => {
    const input = "![alt](/images/foo.png)";
    expect(rewriteInternalLinks(input, resolver)).toBe(input);
  });

  it("大文字混じり slug (本 repo の slug 規約違反) は regex に match させず原文維持", () => {
    // 規約上 slug は `[_a-z0-9][_a-z0-9-]*` のみ。`/posts/Foo` のような大文字混じりを
    // regex で拾うと resolver が null を返し「未配信」扱いされ、本当の未配信 link と
    // 区別が付かなくなるため、regex 段で素通しさせる。
    const input = "[bad](/posts/Foo) と [ok](/posts/db-graph-mcp)";
    const out = rewriteInternalLinks(input, resolver);
    expect(out).toBe(
      "[bad](/posts/Foo) と [ok](https://zenn.dev/aircloset/articles/2731787582881a)",
    );
  });
});

describe("rewriteImageLinks", () => {
  const BASE = "https://ryantsuji.dev";

  it("markdown image (`![alt](/images/...)`) を絶対 URL に書き換え", () => {
    expect(rewriteImageLinks("![alt text](/images/posts/foo/bar.png)", BASE)).toBe(
      "![alt text](https://ryantsuji.dev/images/posts/foo/bar.png)",
    );
  });

  it("link (`[text](/images/...)`) も書き換える (image への直リンク)", () => {
    expect(rewriteImageLinks("[click](/images/foo.png)", BASE)).toBe(
      "[click](https://ryantsuji.dev/images/foo.png)",
    );
  });

  it("複数 image を一括置換", () => {
    const input = "本文\n\n![a](/images/posts/x/a.png)\n\n間\n\n![b](/images/posts/x/b.png)\n";
    const out = rewriteImageLinks(input, BASE);
    expect(out).toContain("https://ryantsuji.dev/images/posts/x/a.png");
    expect(out).toContain("https://ryantsuji.dev/images/posts/x/b.png");
    expect(out).not.toMatch(/\]\(\/images\//);
  });

  it("`/posts/` link は touch しない (rewriteInternalLinks の責務)", () => {
    const input = "[X](/posts/foo) と ![Y](/images/posts/foo/y.png)";
    const out = rewriteImageLinks(input, BASE);
    expect(out).toBe("[X](/posts/foo) と ![Y](https://ryantsuji.dev/images/posts/foo/y.png)");
  });

  it("既に絶対 URL の image は touch しない", () => {
    const input = "![ext](https://example.com/images/foo.png)";
    expect(rewriteImageLinks(input, BASE)).toBe(input);
  });

  it("`/images` で始まらない相対 URL (例 `/assets/...`) は touch しない", () => {
    const input = "![other](/assets/foo.png)";
    expect(rewriteImageLinks(input, BASE)).toBe(input);
  });
});
