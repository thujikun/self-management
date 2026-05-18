/**
 * `check-css-tokens.ts` の helper の分岐網羅 test。pure 関数群 (extractDeclarations /
 * extractReferences / checkCssTokens / stripCssComments) と orchestration 層
 * (runCheckCssTokens) の両方を網羅する。runCheckCssTokens は fs を injection 化して
 * いるので fake `fileExists` / `readFile` を渡して exit code path を検証する。
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business extractDeclarations / extractReferences / checkCssTokens / runCheckCssTokens の分岐網羅 test。fallback 付き var() / dynamic prefix 除外 / 宣言済参照を pass / 未宣言を violation で返す経路 + dist 不在 fail-fast / args 空 path / target file 不在 path を網羅
 * @graph-connects none
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DEFAULT_DYNAMIC_PREFIXES,
  checkCssTokens,
  extractDeclarations,
  extractReferences,
  runCheckCssTokens,
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

  it("CSS コメント内の `--foo:` は宣言として拾わない (= 例示記述を除外、extractReferences と対称)", () => {
    const css = "/* example: --foo: 1px; */ :root { --bar: 1; }";
    expect([...extractDeclarations(css)]).toStrictEqual(["--bar"]);
  });

  it("複数行コメントを跨いだ `--foo:` も宣言として拾わない", () => {
    const css = [
      "/*",
      "  これは説明コメントです。",
      "  --legacy-token: 0.5rem; ← 旧 token、削除済み",
      "*/",
      ":root { --new-token: 1rem; }",
    ].join("\n");
    expect([...extractDeclarations(css)]).toStrictEqual(["--new-token"]);
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

describe("runCheckCssTokens", () => {
  const TOKENS_PATH = "packages/design-tokens/dist/tokens.css";
  const TOKENS_CONTENT = `:root { --accent-bg: white; --accent-fg: black; --space-4: 1rem; }`;

  it("args が空配列なら exit 0 / stderr なし (= staged mode で css 変更なし)", () => {
    const r = runCheckCssTokens({
      args: [],
      designTokensCssPath: TOKENS_PATH,
      fileExists: () => true,
      readFile: () => "",
    });
    expect(r).toStrictEqual({ exitCode: 0, stderr: [] });
  });

  it("args に `.css` が 1 つも無ければ exit 0 (= 非 css file だけ staged のケース)", () => {
    const r = runCheckCssTokens({
      args: ["src/a.ts", "package.json"],
      designTokensCssPath: TOKENS_PATH,
      fileExists: () => true,
      readFile: () => "",
    });
    expect(r).toStrictEqual({ exitCode: 0, stderr: [] });
  });

  it("design-tokens dist 不在は fail-fast (exit 1) で明示 message を出す", () => {
    const r = runCheckCssTokens({
      args: ["app.css"],
      designTokensCssPath: TOKENS_PATH,
      fileExists: (p) => p !== TOKENS_PATH,
      readFile: () => "p { color: var(--accent-bg); }",
    });
    expect(r).toStrictEqual({
      exitCode: 1,
      stderr: [
        `✗ check-css-tokens: ${TOKENS_PATH} not found.`,
        `  design-tokens dist 不在で実行すると semantic token 100+ 件を未宣言と誤検出するため fail-fast します。`,
        "  fix: `pnpm --filter @self/design-tokens build:css` を先に流してください。",
      ],
    });
  });

  it("dist あり + 全 ref が宣言済 → exit 0", () => {
    const fs: Record<string, string> = {
      [TOKENS_PATH]: TOKENS_CONTENT,
      "app.css": `p { color: var(--accent-bg); padding: var(--space-4); }`,
    };
    const r = runCheckCssTokens({
      args: ["app.css"],
      designTokensCssPath: TOKENS_PATH,
      fileExists: (p) => p in fs,
      readFile: (p) => fs[p] ?? "",
    });
    expect(r).toStrictEqual({ exitCode: 0, stderr: [] });
  });

  it("dist あり + 未宣言 ref → exit 1、stderr に violation 列", () => {
    const fs: Record<string, string> = {
      [TOKENS_PATH]: TOKENS_CONTENT,
      "app.css": ["p {", "  color: var(--missing-token);", "}"].join("\n"),
    };
    const r = runCheckCssTokens({
      args: ["app.css"],
      designTokensCssPath: TOKENS_PATH,
      fileExists: (p) => p in fs,
      readFile: (p) => fs[p] ?? "",
    });
    expect(r).toStrictEqual({
      exitCode: 1,
      stderr: [
        "✗ check-css-tokens: undefined CSS custom property reference(s) found:",
        "",
        "  app.css:2  var(--missing-token)  ← not declared",
        "",
        "  fix: 有効な token に置換するか、`packages/design-tokens` の semantic token に追加",
        "       (runtime に inject される `--tw-*` / `--shiki-*` 等は cli の dynamicPrefixes に追加)",
      ],
    });
  });

  it("target file 不在は skip (declaration / reference には足さない)、dist だけで判定して exit 0", () => {
    const fs: Record<string, string> = { [TOKENS_PATH]: TOKENS_CONTENT };
    const r = runCheckCssTokens({
      args: ["deleted.css"],
      designTokensCssPath: TOKENS_PATH,
      fileExists: (p) => p in fs,
      readFile: (p) => fs[p] ?? "",
    });
    expect(r).toStrictEqual({ exitCode: 0, stderr: [] });
  });

  it("dynamic prefix (`--tw-*`) は dist に宣言なくても violation にならない", () => {
    const fs: Record<string, string> = {
      [TOKENS_PATH]: TOKENS_CONTENT,
      "app.css": `p { color: var(--tw-text-color); }`,
    };
    const r = runCheckCssTokens({
      args: ["app.css"],
      designTokensCssPath: TOKENS_PATH,
      fileExists: (p) => p in fs,
      readFile: (p) => fs[p] ?? "",
    });
    expect(r).toStrictEqual({ exitCode: 0, stderr: [] });
  });

  it("non-css args は filter で落ちる ─ `.ts` だけ渡しても dist check は走らない (exit 0)", () => {
    let fileExistsCalls = 0;
    const r = runCheckCssTokens({
      args: ["src/foo.ts"],
      designTokensCssPath: TOKENS_PATH,
      fileExists: () => {
        fileExistsCalls += 1;
        return true;
      },
      readFile: () => "",
    });
    expect(r).toStrictEqual({ exitCode: 0, stderr: [] });
    expect(fileExistsCalls).toBe(0);
  });

  it("対象 css 自身の `:root` 宣言も declaration source に足される (file 完結 token を pass させる)", () => {
    const fs: Record<string, string> = {
      [TOKENS_PATH]: TOKENS_CONTENT,
      // dist には無いが対象 css 自身で宣言された --local
      "app.css": `:root { --local: 1; } p { color: var(--local); }`,
    };
    const r = runCheckCssTokens({
      args: ["app.css"],
      designTokensCssPath: TOKENS_PATH,
      fileExists: (p) => p in fs,
      readFile: (p) => fs[p] ?? "",
    });
    expect(r).toStrictEqual({ exitCode: 0, stderr: [] });
  });

  describe("default fs injection (node:fs)", () => {
    let workDir: string;
    let tokensFile: string;
    let appCssOk: string;
    let appCssBad: string;

    beforeAll(() => {
      workDir = mkdtempSync(join(tmpdir(), "check-css-tokens-"));
      tokensFile = join(workDir, "tokens.css");
      appCssOk = join(workDir, "ok.css");
      appCssBad = join(workDir, "bad.css");
      writeFileSync(tokensFile, `:root { --accent-bg: white; --space-4: 1rem; }`, "utf8");
      writeFileSync(appCssOk, `p { color: var(--accent-bg); padding: var(--space-4); }`, "utf8");
      writeFileSync(appCssBad, `p { color: var(--missing-default-fs-token); }`, "utf8");
    });

    afterAll(() => {
      rmSync(workDir, { recursive: true, force: true });
    });

    it("default fileExists / readFile 経由でも全 ref が宣言済なら exit 0", () => {
      const r = runCheckCssTokens({
        args: [appCssOk],
        designTokensCssPath: tokensFile,
      });
      expect(r).toStrictEqual({ exitCode: 0, stderr: [] });
    });

    it("default fileExists 経由でも dist 不在は fail-fast (exit 1)", () => {
      const r = runCheckCssTokens({
        args: [appCssOk],
        designTokensCssPath: join(workDir, "__never__.css"),
      });
      expect(r.exitCode).toBe(1);
      expect(r.stderr[0]).toBe(`✗ check-css-tokens: ${join(workDir, "__never__.css")} not found.`);
    });

    it("default fileExists / readFile 経由で未宣言 ref → exit 1", () => {
      const r = runCheckCssTokens({
        args: [appCssBad],
        designTokensCssPath: tokensFile,
      });
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toStrictEqual([
        "✗ check-css-tokens: undefined CSS custom property reference(s) found:",
        "",
        `  ${appCssBad}:1  var(--missing-default-fs-token)  ← not declared`,
        "",
        "  fix: 有効な token に置換するか、`packages/design-tokens` の semantic token に追加",
        "       (runtime に inject される `--tw-*` / `--shiki-*` 等は cli の dynamicPrefixes に追加)",
      ]);
    });
  });
});
