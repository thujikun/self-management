/**
 * heading 抽出 + slug 化 + reading time 推定の test。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business heading 抽出と reading time 推定の境界条件 test。code fence 内の "#" は無視、ATX のみ拾う、cjk と alphanumeric を別係数で換算する仕様の保証
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import { estimateReadingTimeMinutes, extractHeadings, slugify } from "./headings.js";

describe("slugify", () => {
  it("英数字 + 空白 → ハイフン区切り lowercase", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("日本語 / 記号は除去", () => {
    expect(slugify("Hello! こんにちは World?")).toBe("hello-world");
  });

  it("先頭 / 末尾の `-` を trim", () => {
    expect(slugify("--- foo bar ---")).toBe("foo-bar");
  });

  it("連続する空白 / ハイフンを 1 つに圧縮", () => {
    expect(slugify("foo   bar---baz")).toBe("foo-bar-baz");
  });
});

describe("extractHeadings", () => {
  it("H2 / H3 のみ拾う (H1 は title field なので除外)", () => {
    const md = `# h1\n## Section A\ntext\n### Sub A1\n# another h1\n## Section B`;
    expect(extractHeadings(md)).toStrictEqual([
      { level: 2, text: "Section A", id: "section-a" },
      { level: 3, text: "Sub A1", id: "sub-a1" },
      { level: 2, text: "Section B", id: "section-b" },
    ]);
  });

  it("code fence 内の `## fake` は無視", () => {
    const md = "## Real\n```\n## fake\n## also fake\n```\n## After fence";
    expect(extractHeadings(md).map((h) => h.text)).toStrictEqual(["Real", "After fence"]);
  });

  it("末尾 `#` の closing-syntax 形式にも対応", () => {
    expect(extractHeadings("## Hello ##")).toStrictEqual([
      { level: 2, text: "Hello", id: "hello" },
    ]);
  });

  it("見出しが 0 件なら空 array", () => {
    expect(extractHeadings("just text\nno headings here")).toStrictEqual([]);
  });
});

describe("estimateReadingTimeMinutes", () => {
  it("空文字 / 短文は最低 1 分", () => {
    expect(estimateReadingTimeMinutes("")).toBe(1);
    expect(estimateReadingTimeMinutes("hello world")).toBe(1);
  });

  it("CJK 1500 文字 (= 3 分相当) は 3 分", () => {
    const cjk = "あ".repeat(1500);
    expect(estimateReadingTimeMinutes(cjk)).toBe(3);
  });

  it("英単語 660 (= 3 分相当) は 3 分", () => {
    const en = "word ".repeat(660).trim();
    expect(estimateReadingTimeMinutes(en)).toBe(3);
  });

  it("code fence と inline code は本文から除外", () => {
    const longCode = "x ".repeat(5000);
    const md = `short body text\n\n\`\`\`js\n${longCode}\n\`\`\``;
    // 本文は "short body text" だけなので最低 1 分
    expect(estimateReadingTimeMinutes(md)).toBe(1);
  });

  it("link は text 部分だけが残る", () => {
    const md = "see [the docs](https://example.com/very-long-url) ".repeat(220);
    // link text = "see the docs" → 660 word で 3 分相当
    expect(estimateReadingTimeMinutes(md)).toBeGreaterThanOrEqual(3);
  });
});
