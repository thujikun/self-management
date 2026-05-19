/**
 * `check-no-bug-cause-comments.ts` の分岐網羅 test。
 *
 * 対象: BUG_CAUSE_PATTERNS の各 description を inline snapshot で SoT 固定し、
 * comment 行で hit / 通常コード行で非 hit / 弱め matcher (`toBe(true|false)` /
 * `toContain` 等) を使わない table-driven `toStrictEqual` で `isCommentLine` /
 * `shouldScan` / `findBugCauseInContent` の網羅 case を組む。
 *
 * @graph-stack core
 * @graph-domain devops
 * @graph-business check-no-bug-cause-comments の pure 関数群の網羅 test。BUG_CAUSE_PATTERNS の description リストを inline snapshot で SoT 固定し、comment 行のみ hit / shouldScan の除外 path / 'used to validate' の purpose 用法を非 hit に固定して policy 退行を防ぐ
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import {
  type BugCauseHit,
  BUG_CAUSE_PATTERNS,
  findBugCauseInContent,
  isCommentLine,
  shouldScan,
} from "./check-no-bug-cause-comments.js";

const DESC = {
  oldImpl: "'旧実装で' は過去経緯の参照。コメントは現状の意図のみを書く。",
  izenWa: "'以前は…していた' は過去経緯の対比。コメントは現状の意図のみを書く。",
  katsuteWa: "'かつては' は過去経緯の参照。コメントは現状の意図のみを書く。",
  bugfix: "'bugfix' は履歴トーン。PR description / commit body に逃がす。",
  fixForBug: "'fix for the bug/issue/crash' は履歴トーン。",
  fixHash: "'fix #123' のような issue 番号参照は履歴トーン。",
  originally: "'originally we …ed' は過去経緯の対比。",
  wasFailing: "'was failing because' は bug-cause 説明。",
  usedTo: "'used to <past-behavior>' は過去経緯の対比。",
} as const;

describe("BUG_CAUSE_PATTERNS", () => {
  it("description リストを inline snapshot で SoT 固定 (追加 / 削除 / 入れ替え時は snapshot を更新)", () => {
    expect(BUG_CAUSE_PATTERNS.map((p) => p.description)).toMatchInlineSnapshot(`
      [
        "'旧実装で' は過去経緯の参照。コメントは現状の意図のみを書く。",
        "'以前は…していた' は過去経緯の対比。コメントは現状の意図のみを書く。",
        "'かつては' は過去経緯の参照。コメントは現状の意図のみを書く。",
        "'bugfix' は履歴トーン。PR description / commit body に逃がす。",
        "'fix for the bug/issue/crash' は履歴トーン。",
        "'fix #123' のような issue 番号参照は履歴トーン。",
        "'originally we …ed' は過去経緯の対比。",
        "'was failing because' は bug-cause 説明。",
        "'used to <past-behavior>' は過去経緯の対比。",
      ]
    `);
  });
});

describe("isCommentLine", () => {
  it("行頭 prefix が comment ものか否かを網羅判定 (`*bugfix` の空白なし block 継続も comment 扱い)", () => {
    const cases: Array<{ line: string; expected: boolean }> = [
      { line: "// foo", expected: true },
      { line: "  // foo", expected: true },
      { line: "/* foo", expected: true },
      { line: " * foo", expected: true },
      { line: " */", expected: true },
      { line: "*bugfix", expected: true },
      { line: "  *bugfix", expected: true },
      { line: "const x = 1;", expected: false },
      { line: "function foo() {", expected: false },
      { line: "", expected: false },
      { line: 'const url = "https://x.com";', expected: false },
    ];
    expect(cases.map((c) => ({ line: c.line, actual: isCommentLine(c.line) }))).toStrictEqual(
      cases.map((c) => ({ line: c.line, actual: c.expected })),
    );
  });
});

describe("findBugCauseInContent — pattern hit (各 9 種、hit 配列全体を toStrictEqual で固定)", () => {
  const cases: Array<{ name: string; content: string; expected: BugCauseHit[] }> = [
    {
      name: "旧実装で (JP)",
      content: "// 旧実装で undefined を返していた",
      expected: [{ line: 1, matched: "旧実装で", description: DESC.oldImpl }],
    },
    {
      name: "以前は…していた (JP)",
      content: "// 以前は同期的に処理していた",
      expected: [{ line: 1, matched: "以前は同期的に処理していた", description: DESC.izenWa }],
    },
    {
      name: "かつては (JP, block 継続)",
      content: " * かつては別 API を叩いていた",
      expected: [{ line: 1, matched: "かつては", description: DESC.katsuteWa }],
    },
    {
      name: "bugfix (EN)",
      content: "// bugfix for null deref",
      expected: [{ line: 1, matched: "bugfix", description: DESC.bugfix }],
    },
    {
      name: "bug-fix (EN, hyphen)",
      content: "// bug-fix applied here",
      expected: [{ line: 1, matched: "bug-fix", description: DESC.bugfix }],
    },
    {
      name: "fix for the bug (EN)",
      content: "// this is a fix for the bug in handler",
      expected: [{ line: 1, matched: "fix for the bug", description: DESC.fixForBug }],
    },
    {
      name: "fix for issue (EN)",
      content: "// fix for issue with input",
      expected: [{ line: 1, matched: "fix for issue", description: DESC.fixForBug }],
    },
    {
      name: "fix #123 (EN)",
      content: "// fix #4321",
      expected: [{ line: 1, matched: "fix #4321", description: DESC.fixHash }],
    },
    {
      name: "originally we …ed (EN)",
      content: "// originally we returned null",
      expected: [{ line: 1, matched: "originally we returned", description: DESC.originally }],
    },
    {
      name: "was failing because (EN)",
      content: "// was failing because of race",
      expected: [{ line: 1, matched: "was failing because", description: DESC.wasFailing }],
    },
    {
      name: "used to throw (EN, 過去経緯動詞)",
      content: "// used to throw here",
      expected: [{ line: 1, matched: "used to throw", description: DESC.usedTo }],
    },
    {
      name: "used to return (EN, 過去経緯動詞)",
      content: "// used to return null on empty input",
      expected: [{ line: 1, matched: "used to return", description: DESC.usedTo }],
    },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(findBugCauseInContent(c.content)).toStrictEqual(c.expected);
    });
  }
});

describe("findBugCauseInContent — non-hit (`used to <purpose>` 等の false-positive 回避を含む)", () => {
  const cases: Array<{ name: string; content: string }> = [
    {
      name: "通常コード行に同じ文字列があっても hit しない (= 行頭 comment anchor)",
      content: ["const note = '旧実装で undefined を返していた';", "const fix = '#123';"].join(
        "\n",
      ),
    },
    {
      name: "comment 行でも bug-cause 系語句なしなら hit しない",
      content: [
        "// このフラグは admin login 時に preview を有効にする",
        "// IntersectionObserver で active heading を切替える",
      ].join("\n"),
    },
    {
      name: "空入力は空配列",
      content: "",
    },
    {
      name: "'used to validate' は purpose 用法、hit しない (Major #2 false-positive 回避)",
      content: "// used to validate input",
    },
    {
      name: "'used to format' は purpose 用法、hit しない",
      content: "// helper used to format dates",
    },
    {
      name: "'used to normalize' は purpose 用法、hit しない",
      content: "// used to normalize URLs",
    },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(findBugCauseInContent(c.content)).toStrictEqual([]);
    });
  }
});

describe("findBugCauseInContent — 複合ケース", () => {
  it("mixed comments / strings は comment 行の hit だけ拾い、行番号順に整列", () => {
    const content = [
      "// fix for the bug in handler",
      "const msg = 'fix for the bug in copy';",
      "const x = 1;",
      "/* 以前は throw していた */",
    ].join("\n");
    expect(findBugCauseInContent(content)).toStrictEqual([
      { line: 1, matched: "fix for the bug", description: DESC.fixForBug },
      { line: 4, matched: "以前は throw していた", description: DESC.izenWa },
    ]);
  });

  it("1 行に複数 pattern が一致したら hit を全部 (順序固定で) 返す", () => {
    const content = "// 旧実装で undefined を返していた。bugfix で修正済み";
    expect(findBugCauseInContent(content)).toStrictEqual([
      { line: 1, matched: "旧実装で", description: DESC.oldImpl },
      { line: 1, matched: "bugfix", description: DESC.bugfix },
    ]);
  });
});

describe("shouldScan", () => {
  it("ext / 除外 path を網羅判定 (table-driven、toStrictEqual で全件固定)", () => {
    const cases: Array<{ path: string; expected: boolean }> = [
      { path: "apps/foo/src/bar.ts", expected: true },
      { path: "apps/foo/src/Bar.tsx", expected: true },
      { path: "apps/foo/src/bar.test.ts", expected: false },
      { path: "apps/foo/src/bar.spec.ts", expected: false },
      { path: "apps/foo/src/Bar.test.tsx", expected: false },
      { path: "apps/foo/src/Bar.spec.tsx", expected: false },
      { path: "dist/foo.ts", expected: false },
      { path: "apps/foo/dist/bar.ts", expected: false },
      { path: "node_modules/x/index.ts", expected: false },
      { path: "coverage/lcov.ts", expected: false },
      { path: "apps/foo/__fixtures__/sample.ts", expected: false },
      { path: "apps/foo/fixtures/sample.ts", expected: false },
      { path: "README.md", expected: false },
      { path: "package.json", expected: false },
      { path: ".github/workflows/ci.yml", expected: false },
    ];
    expect(cases.map((c) => ({ path: c.path, actual: shouldScan(c.path) }))).toStrictEqual(
      cases.map((c) => ({ path: c.path, actual: c.expected })),
    );
  });
});
