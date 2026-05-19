/**
 * `check-no-bug-cause-comments.ts` の分岐網羅 test。
 *
 * 対象: BUG_CAUSE_PATTERNS の 9 種それぞれが comment 行で hit すること、
 * comment ではない通常コード行 (= 自然語に同じ文字列が出ても) で hit しないこと、
 * `shouldScan` の各除外 path、`findBugCauseInContent` の整列性 / 空入力。
 *
 * @graph-stack core
 * @graph-domain devops
 * @graph-business check-no-bug-cause-comments の pure 関数群の網羅 test。9 個の bug-cause pattern が comment 行のみで hit すること、shouldScan が .test.ts / .spec.ts / dist / fixtures を除外することを inline で固定し、policy 退行を防ぐ
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import {
  BUG_CAUSE_PATTERNS,
  findBugCauseInContent,
  isCommentLine,
  shouldScan,
} from "./check-no-bug-cause-comments.js";

describe("BUG_CAUSE_PATTERNS", () => {
  it("9 個の pattern が登録されている (SoT 固定、追加時は test 同時更新)", () => {
    expect(BUG_CAUSE_PATTERNS).toHaveLength(9);
  });
});

describe("isCommentLine", () => {
  it("`// ...` を comment 行として認識", () => {
    expect(isCommentLine("// foo")).toBe(true);
    expect(isCommentLine("  // foo")).toBe(true);
  });

  it("block コメントの各形態を comment 行として認識", () => {
    expect(isCommentLine("/* foo")).toBe(true);
    expect(isCommentLine(" * foo")).toBe(true);
    expect(isCommentLine(" */")).toBe(true);
  });

  it("通常コード行は comment ではない", () => {
    expect(isCommentLine("const x = 1;")).toBe(false);
    expect(isCommentLine("function foo() {")).toBe(false);
    expect(isCommentLine("")).toBe(false);
  });

  it("文字列リテラル内に `//` があるコード行は comment 扱いしない (行頭 anchor)", () => {
    expect(isCommentLine('const url = "https://x.com";')).toBe(false);
  });
});

describe("findBugCauseInContent — pattern hit", () => {
  const cases: Array<{ name: string; line: string; expected: string }> = [
    { name: "旧実装で (JP)", line: "// 旧実装で undefined を返していた", expected: "旧実装で" },
    {
      name: "以前は…していた (JP)",
      line: "// 以前は同期的に処理していた",
      expected: "以前は同期的に処理していた",
    },
    { name: "かつては (JP)", line: " * かつては別 API を叩いていた", expected: "かつては" },
    { name: "bugfix (EN)", line: "// bugfix for null deref", expected: "bugfix" },
    { name: "bug-fix (EN, hyphen)", line: "// bug-fix applied here", expected: "bug-fix" },
    {
      name: "fix for the bug (EN)",
      line: "// this is a fix for the bug in #123",
      expected: "fix for the bug",
    },
    {
      name: "fix for issue (EN)",
      line: "// fix for issue with input",
      expected: "fix for issue",
    },
    { name: "fix #123 (EN)", line: "// fix #4321", expected: "fix #4321" },
    {
      name: "originally we …ed (EN)",
      line: "// originally we returned null",
      expected: "originally we returned",
    },
    {
      name: "was failing because (EN)",
      line: "// was failing because of race",
      expected: "was failing because",
    },
    { name: "used to … (EN)", line: "// used to throw here", expected: "used to throw" },
  ];

  for (const c of cases) {
    it(`${c.name} を hit させる`, () => {
      const hits = findBugCauseInContent(c.line);
      expect(hits).toHaveLength(1);
      expect(hits[0]?.matched.toLowerCase()).toContain(c.expected.toLowerCase());
      expect(hits[0]?.line).toBe(1);
    });
  }
});

describe("findBugCauseInContent — non-hit", () => {
  it("通常コード行に同じ文字列があっても hit しない (= 行頭 comment anchor)", () => {
    const content = ["const note = '旧実装で undefined を返していた';", "const fix = '#123';"].join(
      "\n",
    );
    expect(findBugCauseInContent(content)).toStrictEqual([]);
  });

  it("comment 行でも bug-cause 系語句なしなら hit しない", () => {
    const content = [
      "// このフラグは admin login 時に preview を有効にする",
      "// IntersectionObserver で active heading を切替える",
    ].join("\n");
    expect(findBugCauseInContent(content)).toStrictEqual([]);
  });

  it("空入力は空配列", () => {
    expect(findBugCauseInContent("")).toStrictEqual([]);
  });

  it("complex code with mixed comments / strings は comment 行の hit だけ拾う", () => {
    const content = [
      "// fix for the bug in handler",
      "const msg = 'fix for the bug in copy';",
      "const x = 1;",
      "/* 以前は throw していた */",
    ].join("\n");
    const hits = findBugCauseInContent(content);
    expect(hits.map((h) => h.line)).toStrictEqual([1, 4]);
  });

  it("複数 hit を行番号順に返す", () => {
    const content = ["// 旧実装で undefined", "const x = 1;", "// bugfix applied"].join("\n");
    const hits = findBugCauseInContent(content);
    expect(hits).toHaveLength(2);
    expect(hits[0]?.line).toBe(1);
    expect(hits[1]?.line).toBe(3);
  });

  it("1 行に複数 pattern が一致したら hit を全部返す", () => {
    const content = "// 旧実装で undefined を返していた。bugfix で修正済み";
    const hits = findBugCauseInContent(content);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    const matched = hits.map((h) => h.matched.toLowerCase());
    expect(matched.some((m) => m.includes("旧実装で"))).toBe(true);
    expect(matched.some((m) => m.includes("bugfix"))).toBe(true);
  });
});

describe("shouldScan", () => {
  it(".ts / .tsx は対象", () => {
    expect(shouldScan("apps/foo/src/bar.ts")).toBe(true);
    expect(shouldScan("apps/foo/src/Bar.tsx")).toBe(true);
  });

  it(".test.ts / .spec.ts / .test.tsx / .spec.tsx は除外", () => {
    expect(shouldScan("apps/foo/src/bar.test.ts")).toBe(false);
    expect(shouldScan("apps/foo/src/bar.spec.ts")).toBe(false);
    expect(shouldScan("apps/foo/src/Bar.test.tsx")).toBe(false);
    expect(shouldScan("apps/foo/src/Bar.spec.tsx")).toBe(false);
  });

  it("dist / node_modules / coverage / fixtures は除外", () => {
    expect(shouldScan("dist/foo.ts")).toBe(false);
    expect(shouldScan("apps/foo/dist/bar.ts")).toBe(false);
    expect(shouldScan("node_modules/x/index.ts")).toBe(false);
    expect(shouldScan("coverage/lcov.ts")).toBe(false);
    expect(shouldScan("apps/foo/__fixtures__/sample.ts")).toBe(false);
    expect(shouldScan("apps/foo/fixtures/sample.ts")).toBe(false);
  });

  it(".md / .json / .yaml 等の非対象 ext は除外", () => {
    expect(shouldScan("README.md")).toBe(false);
    expect(shouldScan("package.json")).toBe(false);
    expect(shouldScan(".github/workflows/ci.yml")).toBe(false);
  });
});
