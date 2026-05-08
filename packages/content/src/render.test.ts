/**
 * `renderMarkdown` の end-to-end test。
 *
 * 実際の markdown source を入れて HTML / frontmatter / headings / readingTime が
 * 期待通りに structured object として返ることを確認する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business markdown render pipeline の E2E (network-free)。frontmatter parse、GFM table 展開、shiki によるコードブロック token 化、heading slug 抽出、autolink 適用が 1 関数で正常動作することを確認する
 * @graph-connects none
 */

import { beforeAll, describe, expect, it } from "vitest";

import { renderMarkdown } from "./render.js";

describe("renderMarkdown", () => {
  // shiki / unified の cold-start (WASM + grammar / theme load) が --coverage 下で
  // 30s に届かず先頭テストが flake するため、ここで dummy 1 回流して prewarm する。
  // ts-morph の prewarm パターンと同様、テスト本体の timeout を変えずに吸収する。
  beforeAll(async () => {
    await renderMarkdown(
      ["---", 'title: "warmup"', 'publishedAt: "2026-05-08"', "---", "warm"].join("\n"),
    );
  }, 60_000);

  it("frontmatter + body を正しく分離して RenderedDoc を返す", async () => {
    const source = [
      "---",
      'title: "Hello"',
      'publishedAt: "2026-05-08"',
      "tags:",
      "  - TypeScript",
      "  - rsc",
      "---",
      "",
      "## Section A",
      "",
      "Some prose body.",
    ].join("\n");

    const out = await renderMarkdown(source);

    expect(out.frontmatter).toStrictEqual({
      title: "Hello",
      publishedAt: "2026-05-08",
      tags: ["rsc", "typescript"],
      draft: false,
      lang: "ja",
    });
    expect(out.headings).toStrictEqual([{ level: 2, text: "Section A", id: "section-a" }]);
    expect(out.readingTimeMinutes).toBeGreaterThanOrEqual(1);
  });

  it("見出しに rehype-slug の id + autolink が付く", async () => {
    const source = [
      "---",
      'title: "x"',
      'publishedAt: "2026-05-08"',
      "---",
      "",
      "## My Heading",
      "",
      "body",
    ].join("\n");
    const out = await renderMarkdown(source);
    expect(out.html).toMatch(/<h2 id="my-heading">/);
    expect(out.html).toMatch(/<a href="#my-heading"/);
  });

  it("GFM の table syntax が table 要素に展開される", async () => {
    const source = [
      "---",
      'title: "x"',
      'publishedAt: "2026-05-08"',
      "---",
      "",
      "| col1 | col2 |",
      "|------|------|",
      "| a    | b    |",
    ].join("\n");
    const out = await renderMarkdown(source);
    expect(out.html).toMatch(/<table>/);
    expect(out.html).toMatch(/<th>col1<\/th>/);
    expect(out.html).toMatch(/<td>a<\/td>/);
  });

  it("code fence は shiki により token span に分解される", async () => {
    const source = [
      "---",
      'title: "x"',
      'publishedAt: "2026-05-08"',
      "---",
      "",
      "```ts",
      "const x: number = 1;",
      "```",
    ].join("\n");
    const out = await renderMarkdown(source);
    // shiki は <pre class="shiki shiki-themes ..."> + <span> token 化された code を吐く
    expect(out.html).toMatch(/<pre class="shiki/);
    expect(out.html).toMatch(/<span style="--shiki-/);
    // light/dark theme 両方を data attribute でなく CSS variable で持つ pattern
    expect(out.html).toMatch(/--shiki-light/);
    expect(out.html).toMatch(/--shiki-dark/);
  });

  it("frontmatter 不正で throw", async () => {
    const source = `---\ntitle: "x"\npublishedAt: "May 8 2026"\n---\nbody`;
    await expect(renderMarkdown(source)).rejects.toThrow();
  });
});
