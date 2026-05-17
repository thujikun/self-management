/**
 * `coverage-config.ts` の helper test。
 *
 * matchGlob / isCovered / candidateTestFiles の各分岐を pure に踏む。COVERAGE_INCLUDE
 * / COVERAGE_EXCLUDE / COVERAGE_THRESHOLDS の export 値も簡易に固定し、誤って空に
 * なる回帰を取る。
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business coverage-config.ts の helper / 定数 export の挙動を pre-commit / CI 両方の経路で同じ判定にするための回帰 test。glob 一致と include/exclude 判定の境界を網羅する
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import {
  candidateTestFiles,
  COVERAGE_EXCLUDE,
  COVERAGE_INCLUDE,
  COVERAGE_THRESHOLDS,
  isCovered,
  matchGlob,
} from "./coverage-config.js";

describe("matchGlob", () => {
  it("`**` で任意 path segment 列に一致", () => {
    expect(matchGlob("**/dist/**", "apps/x/dist/index.js")).toBe(true);
    expect(matchGlob("**/dist/**", "apps/x/src/index.js")).toBe(false);
  });

  it("`*` は / を含まない 1 segment のみ一致", () => {
    expect(matchGlob("scripts/*.cli.ts", "scripts/foo.cli.ts")).toBe(true);
    expect(matchGlob("scripts/*.cli.ts", "scripts/sub/foo.cli.ts")).toBe(false);
  });

  it("`{a,b}` でグループ alternation", () => {
    expect(matchGlob("**/*.{ts,tsx}", "apps/web/src/foo.ts")).toBe(true);
    expect(matchGlob("**/*.{ts,tsx}", "apps/web/src/foo.tsx")).toBe(true);
    expect(matchGlob("**/*.{ts,tsx}", "apps/web/src/foo.js")).toBe(false);
  });

  it("literal `.` は escape されて regex の任意文字にならない", () => {
    expect(matchGlob("foo.ts", "fooXts")).toBe(false);
    expect(matchGlob("foo.ts", "foo.ts")).toBe(true);
  });

  it("複数 `**` の連続でも正しく greedy 振る舞い", () => {
    expect(matchGlob("apps/**/src/**/*.ts", "apps/web/src/lib/foo.ts")).toBe(true);
    expect(matchGlob("apps/**/src/**/*.ts", "apps/web/lib/foo.ts")).toBe(false);
  });
});

describe("isCovered", () => {
  it("include パターン (apps/**/src) + exclude 該当なし → true", () => {
    expect(isCovered("apps/ryantsuji-dev/web/src/server/posts.ts")).toBe(true);
  });

  it("include 外 (apps/.../node_modules) → false", () => {
    expect(isCovered("apps/web/node_modules/foo.ts")).toBe(false);
  });

  it("include 内でも *.test.ts は exclude → false", () => {
    expect(isCovered("apps/ryantsuji-dev/web/src/lib/tags.test.ts")).toBe(false);
  });

  it("exclude 明示パスは false (db.ts / .server.ts / cli.ts)", () => {
    expect(isCovered("apps/ryantsuji-dev/web/src/server/db.ts")).toBe(false);
    expect(isCovered("apps/ryantsuji-dev/web/src/routes/posts/$slug.server.ts")).toBe(false);
    expect(isCovered("scripts/hooks/check-staged-coverage.cli.ts")).toBe(false);
  });

  it("routeTree.gen.ts は exclude", () => {
    expect(isCovered("apps/ryantsuji-dev/web/src/routeTree.gen.ts")).toBe(false);
  });

  it("packages/<x>/src の通常 ts は include", () => {
    expect(isCovered("packages/content/src/frontmatter.ts")).toBe(true);
  });
});

describe("candidateTestFiles", () => {
  it("foo.ts → foo.test.ts / foo.test.tsx を候補", () => {
    expect(candidateTestFiles("apps/web/src/foo.ts")).toStrictEqual([
      "apps/web/src/foo.test.ts",
      "apps/web/src/foo.test.tsx",
    ]);
  });

  it("foo.tsx → foo.test.ts / foo.test.tsx を候補", () => {
    expect(candidateTestFiles("apps/web/src/foo.tsx")).toStrictEqual([
      "apps/web/src/foo.test.ts",
      "apps/web/src/foo.test.tsx",
    ]);
  });
});

describe("constants are non-empty (regression)", () => {
  it("COVERAGE_INCLUDE / COVERAGE_EXCLUDE は要素を持つ", () => {
    expect(COVERAGE_INCLUDE.length).toBeGreaterThan(0);
    expect(COVERAGE_EXCLUDE.length).toBeGreaterThan(0);
  });

  it("COVERAGE_THRESHOLDS は perFile=true + 90% 4 種", () => {
    expect(COVERAGE_THRESHOLDS).toStrictEqual({
      perFile: true,
      lines: 90,
      functions: 90,
      branches: 90,
      statements: 90,
    });
  });
});
