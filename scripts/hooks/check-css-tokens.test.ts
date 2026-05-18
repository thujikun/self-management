/**
 * `check-css-tokens.ts` の pure helper の分岐網羅 test。
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business extractDeclarations / extractReferences / checkCssTokens の分岐網羅 test。fallback 付き var() / dynamic prefix 除外 / 宣言済参照を pass / 未宣言を violation で返す経路を網羅
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_DYNAMIC_PREFIXES,
  checkCssTokens,
  extractDeclarations,
  extractReferences,
  stripCssComments,
} from "./check-css-tokens.js";

describe("extractDeclarations", () => {
  it(":root 内 `--xxx:` 宣言を集める", () => {
    const css = `
:root {
  --space-4: 1rem;
  --bg-base: oklch(100% 0 0);
}
`;
    const out = extractDeclarations(css);
    expect([...out].sort()).toStrictEqual(["--bg-base", "--space-4"]);
  });

  it("`@theme {}` ブロックも対象", () => {
    const css = `@theme { --color-accent: var(--accent-bg); --spacing-3: var(--space-3); }`;
    const out = extractDeclarations(css);
    expect([...out].sort()).toStrictEqual(["--color-accent", "--spacing-3"]);
  });

  it("`var(--y)` の `--y` は **参照** なので宣言として拾わない", () => {
    const css = `:root { --foo: var(--bar); }`;
    const out = extractDeclarations(css);
    expect([...out]).toStrictEqual(["--foo"]);
  });

  it("複数 selector に同じ token (= dark mode override) は 1 つに dedupe", () => {
    const css = `:root { --x: white; } @media (prefers-color-scheme: dark) { :root { --x: black; } }`;
    const out = extractDeclarations(css);
    expect([...out]).toStrictEqual(["--x"]);
  });
});

describe("extractReferences", () => {
  it("`var(--xxx)` を行番号付きで集める", () => {
    const css = [
      "body {",
      "  color: var(--text-primary);",
      "  background: var(--bg-base);",
      "}",
    ].join("\n");
    const out = extractReferences(css);
    expect(out).toStrictEqual([
      { token: "--text-primary", line: 2 },
      { token: "--bg-base", line: 3 },
    ]);
  });

  it("fallback 付き var(--x, fallback) も x を refs に入れる", () => {
    const css = `a { color: var(--text-accent, blue); }`;
    expect(extractReferences(css)).toStrictEqual([{ token: "--text-accent", line: 1 }]);
  });

  it("同一行に複数 var() あれば全部拾う", () => {
    const css = `b { margin: var(--space-2) var(--space-4); }`;
    expect(extractReferences(css)).toStrictEqual([
      { token: "--space-2", line: 1 },
      { token: "--space-4", line: 1 },
    ]);
  });

  it("`--xxx:` 宣言行は ref として拾わない", () => {
    const css = `:root { --custom: 1rem; }`;
    expect(extractReferences(css)).toStrictEqual([]);
  });

  it("CSS コメント内の `var(--xxx)` は ref として拾わない (= 文章中の説明用記述を除外)", () => {
    const css = [
      "/* design-tokens に warning が入ったら `var(--text-warning)` に差し替える */",
      "p { color: var(--text-primary); }",
    ].join("\n");
    const refs = extractReferences(css);
    expect(refs).toStrictEqual([{ token: "--text-primary", line: 2 }]);
  });
});

describe("stripCssComments", () => {
  it("`/* ... */` を空白に置換し、行番号は保持する", () => {
    const input = "a /* hello */ b\nc /* multi\nline */ d";
    const out = stripCssComments(input);
    expect(out.split("\n")).toHaveLength(3);
    expect(out).toContain("a ");
    expect(out).toContain(" b");
    expect(out).not.toContain("hello");
    expect(out).not.toContain("multi");
  });

  it("コメント無し入力は変更しない", () => {
    expect(stripCssComments("a { x: 1; }")).toBe("a { x: 1; }");
  });

  it("空文字列は空文字列を返す", () => {
    expect(stripCssComments("")).toBe("");
  });
});

describe("edge cases", () => {
  it("extractDeclarations: 空 CSS は空 Set", () => {
    expect([...extractDeclarations("")]).toStrictEqual([]);
  });

  it("extractReferences: 空 CSS は空配列", () => {
    expect(extractReferences("")).toStrictEqual([]);
  });

  it("checkCssTokens: declaration / reference 両方空なら violation なし", () => {
    expect(
      checkCssTokens({
        declarationSources: [],
        referenceSources: [],
        dynamicPrefixes: [],
      }),
    ).toStrictEqual([]);
  });

  it("checkCssTokens: dynamicPrefixes が空配列でも動く", () => {
    expect(
      checkCssTokens({
        declarationSources: [{ file: "t.css", content: ":root { --x: 1; }" }],
        referenceSources: [{ file: "a.css", content: "p { color: var(--x); }" }],
        dynamicPrefixes: [],
      }),
    ).toStrictEqual([]);
  });

  it("extractReferences: var(--x) と同行のコメント `/* var(--y) */` で y は ref に拾わない", () => {
    const css = "p { color: var(--x) /* var(--y) */; }";
    expect(extractReferences(css)).toStrictEqual([{ token: "--x", line: 1 }]);
  });
});

describe("checkCssTokens", () => {
  const declared = {
    file: "tokens.css",
    content: `:root { --space-4: 1rem; --bg-base: white; --text-primary: black; }`,
  };

  it("宣言済 token への参照は violation なし", () => {
    const v = checkCssTokens({
      declarationSources: [declared],
      referenceSources: [
        { file: "app.css", content: `p { color: var(--text-primary); padding: var(--space-4); }` },
      ],
      dynamicPrefixes: DEFAULT_DYNAMIC_PREFIXES,
    });
    expect(v).toStrictEqual([]);
  });

  it("未宣言の token への参照は violation", () => {
    const v = checkCssTokens({
      declarationSources: [declared],
      referenceSources: [
        {
          file: "app.css",
          content: ["p {", "  padding: var(--space-5);", "  margin: var(--radius-2);", "}"].join(
            "\n",
          ),
        },
      ],
      dynamicPrefixes: DEFAULT_DYNAMIC_PREFIXES,
    });
    expect(v).toStrictEqual([
      { file: "app.css", line: 2, token: "--space-5" },
      { file: "app.css", line: 3, token: "--radius-2" },
    ]);
  });

  it("dynamic prefix (`--tw-*`, `--shiki-*`) は宣言なくても OK", () => {
    const v = checkCssTokens({
      declarationSources: [declared],
      referenceSources: [
        {
          file: "app.css",
          content: `p { color: var(--tw-text-color); background: var(--shiki-light-bg); }`,
        },
      ],
      dynamicPrefixes: DEFAULT_DYNAMIC_PREFIXES,
    });
    expect(v).toStrictEqual([]);
  });

  it("declaration source は複数渡せる (design-tokens + own css)", () => {
    const v = checkCssTokens({
      declarationSources: [
        { file: "a.css", content: `:root { --a: 1; }` },
        { file: "b.css", content: `:root { --b: 2; }` },
      ],
      referenceSources: [{ file: "app.css", content: `p { x: var(--a); y: var(--b); }` }],
      dynamicPrefixes: [],
    });
    expect(v).toStrictEqual([]);
  });

  it("複数 file の参照と violation は file 別に集約", () => {
    const v = checkCssTokens({
      declarationSources: [declared],
      referenceSources: [
        { file: "a.css", content: `p { color: var(--undefined-a); }` },
        { file: "b.css", content: `p { color: var(--undefined-b); }` },
      ],
      dynamicPrefixes: [],
    });
    expect(v).toStrictEqual([
      { file: "a.css", line: 1, token: "--undefined-a" },
      { file: "b.css", line: 1, token: "--undefined-b" },
    ]);
  });
});
