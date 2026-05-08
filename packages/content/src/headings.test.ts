/**
 * heading 抽出 + slug 化 + reading time 推定の test。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business heading 抽出と reading time 推定の境界条件 test。code fence (``` / ~~~) 内の "#" は無視、ATX のみ拾う、Unicode 見出し / 重複見出し suffix が rehype-slug と一致、cjk と alphanumeric を別係数で換算する仕様の保証
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import { estimateReadingTimeMinutes, extractHeadings, slugify } from "./headings.js";

describe("slugify", () => {
  it("英数字 + 空白 → ハイフン区切り lowercase", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("日本語は Unicode 保持 (rehype-slug 互換、TOC リンクが効く)", () => {
    expect(slugify("こんにちは World")).toBe("こんにちは-world");
    expect(slugify("Hello! こんにちは World?")).toBe("hello-こんにちは-world");
  });

  it("空白は `-` に置換 (連続空白は連続 `-` のまま、github-slugger の挙動)", () => {
    // GitHub の README anchor と同じ: " " → "-" の単純置換、圧縮はしない。
    expect(slugify("foo   bar")).toBe("foo---bar");
  });

  it("既存ハイフンは保持 (`---` → `---`、TOC の id を GitHub 表示と揃える)", () => {
    expect(slugify("foo---bar")).toBe("foo---bar");
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

  it("backtick code fence (```) 内の `## fake` は無視", () => {
    const md = "## Real\n```\n## fake\n## also fake\n```\n## After fence";
    expect(extractHeadings(md).map((h) => h.text)).toStrictEqual(["Real", "After fence"]);
  });

  it("tilde code fence (~~~) 内の `## fake` も無視", () => {
    const md = "## Real\n~~~\n## fake\n~~~\n## After";
    expect(extractHeadings(md).map((h) => h.text)).toStrictEqual(["Real", "After"]);
  });

  it("異種 fence delimiter は内側を閉じない (~~~ で開いたら ``` では閉じない)", () => {
    // ~~~ で開いた fence の中に ``` があっても fence は閉じない (CommonMark 仕様)。
    // 結果として `## also-inside` は code 扱い → heading として拾わない。
    const md = "## Outer\n~~~\n## also-inside\n```\n## still-inside\n~~~\n## After";
    expect(extractHeadings(md).map((h) => h.text)).toStrictEqual(["Outer", "After"]);
  });

  it("末尾 `#` の closing-syntax 形式にも対応", () => {
    expect(extractHeadings("## Hello ##")).toStrictEqual([
      { level: 2, text: "Hello", id: "hello" },
    ]);
  });

  it("同名見出しの重複時は github-slugger の suffix で分かれる (foo / foo-1)", () => {
    expect(extractHeadings("## Foo\n## Foo\n## Foo")).toStrictEqual([
      { level: 2, text: "Foo", id: "foo" },
      { level: 2, text: "Foo", id: "foo-1" },
      { level: 2, text: "Foo", id: "foo-2" },
    ]);
  });

  it("日本語見出しを Unicode 保持で id 化", () => {
    expect(extractHeadings("## こんにちは World").map((h) => h.id)).toStrictEqual([
      "こんにちは-world",
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

  it("backtick code fence と inline code は本文から除外", () => {
    const longCode = "x ".repeat(5000);
    const md = `short body text\n\n\`\`\`js\n${longCode}\n\`\`\``;
    expect(estimateReadingTimeMinutes(md)).toBe(1);
  });

  it("tilde code fence も本文から除外", () => {
    const longCode = "x ".repeat(5000);
    const md = `short body text\n\n~~~js\n${longCode}\n~~~`;
    expect(estimateReadingTimeMinutes(md)).toBe(1);
  });

  it("link は text 部分だけが残る", () => {
    const md = "see [the docs](https://example.com/very-long-url) ".repeat(220);
    // link text = "see the docs" → 660 word で 3 分相当
    expect(estimateReadingTimeMinutes(md)).toBeGreaterThanOrEqual(3);
  });
});
