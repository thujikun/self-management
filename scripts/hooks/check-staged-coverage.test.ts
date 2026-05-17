/**
 * `check-staged-coverage.ts` の pure logic test。
 *
 * lookupTestFiles / partitionLookups / buildVitestArgs / formatMissingError の各
 * 分岐を踏む。fileExists は injection 化されているので、test 用 fake で coverage
 * 対象判定 + 存在判定の合成を検証する。
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business pre-commit coverage-staged gate の pure logic test。staged file が coverage 対象か / test file が存在するか / vitest CLI 引数の組立てを境界含めて網羅する
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import {
  buildVitestArgs,
  formatMissingError,
  lookupTestFiles,
  partitionLookups,
} from "./check-staged-coverage.js";
import { COVERAGE_THRESHOLDS } from "./coverage-config.js";

describe("lookupTestFiles", () => {
  it("coverage 対象外 (test file / db.ts / cli.ts) は skipped 行きで covered には入らない", () => {
    const { covered, skipped } = lookupTestFiles(
      [
        "apps/ryantsuji-dev/web/src/lib/foo.test.ts",
        "apps/ryantsuji-dev/web/src/server/db.ts",
        "scripts/hooks/foo.cli.ts",
        "apps/ryantsuji-dev/web/src/routeTree.gen.ts",
      ],
      () => false,
    );
    expect(covered).toStrictEqual([]);
    expect(skipped.sort()).toStrictEqual(
      [
        "apps/ryantsuji-dev/web/src/lib/foo.test.ts",
        "apps/ryantsuji-dev/web/src/server/db.ts",
        "apps/ryantsuji-dev/web/src/routeTree.gen.ts",
        "scripts/hooks/foo.cli.ts",
      ].sort(),
    );
  });

  it("coverage 対象 + test file 存在 → covered に testFile 入りで return", () => {
    const { covered, skipped } = lookupTestFiles(
      ["apps/ryantsuji-dev/web/src/lib/foo.ts"],
      (p) => p === "apps/ryantsuji-dev/web/src/lib/foo.test.ts",
    );
    expect(skipped).toStrictEqual([]);
    expect(covered).toStrictEqual([
      {
        source: "apps/ryantsuji-dev/web/src/lib/foo.ts",
        testFile: "apps/ryantsuji-dev/web/src/lib/foo.test.ts",
      },
    ]);
  });

  it("coverage 対象 + test file 不在 → covered に testFile=null で return", () => {
    const { covered } = lookupTestFiles(["apps/ryantsuji-dev/web/src/lib/foo.ts"], () => false);
    expect(covered).toStrictEqual([
      { source: "apps/ryantsuji-dev/web/src/lib/foo.ts", testFile: null },
    ]);
  });

  it("`.tsx` source は .test.tsx が見つかればそれを採用", () => {
    const { covered } = lookupTestFiles(
      ["apps/ryantsuji-dev/web/src/routes/about.tsx"],
      (p) => p === "apps/ryantsuji-dev/web/src/routes/about.test.tsx",
    );
    expect(covered[0]?.testFile).toBe("apps/ryantsuji-dev/web/src/routes/about.test.tsx");
  });
});

describe("partitionLookups", () => {
  it("testFile=null は missing 行き、それ以外は sources に対応", () => {
    const { missing, sources } = partitionLookups([
      { source: "a.ts", testFile: "a.test.ts" },
      { source: "b.ts", testFile: null },
      { source: "c.ts", testFile: "c.test.ts" },
    ]);
    expect(missing).toStrictEqual(["b.ts"]);
    expect(sources).toStrictEqual(["a.ts", "c.ts"]);
  });

  it("全て missing なら sources は空", () => {
    const { missing, sources } = partitionLookups([{ source: "x.ts", testFile: null }]);
    expect(missing).toStrictEqual(["x.ts"]);
    expect(sources).toStrictEqual([]);
  });
});

describe("buildVitestArgs", () => {
  // SSoT 一致を機械強制するため expected も COVERAGE_THRESHOLDS から導出する。
  // literal `90` を直書きすると SSoT を上げた瞬間に「実装側 SSoT 経由 / test 側 literal」
  // という新たな drift が生まれ、本 PR の中核 (drift 構造的に不可能) が崩れる。
  const expectedThresholdArgs = Object.entries(COVERAGE_THRESHOLDS).map(
    ([k, v]) => `--coverage.thresholds.${k}=${v}`,
  );

  it("`vitest related` subcommand + --coverage.include + threshold + sources の引数列を組む", () => {
    const args = buildVitestArgs(["a.ts", "b.tsx"]);
    expect(args).toStrictEqual([
      "exec",
      "vitest",
      "related",
      "--coverage",
      ...expectedThresholdArgs,
      "--coverage.include=a.ts",
      "--coverage.include=b.tsx",
      "a.ts",
      "b.tsx",
    ]);
  });

  it("sources 空でも threshold + subcommand で意味的に valid な引数列", () => {
    const args = buildVitestArgs([]);
    expect(args).toStrictEqual([
      "exec",
      "vitest",
      "related",
      "--coverage",
      ...expectedThresholdArgs,
    ]);
  });
});

describe("formatMissingError", () => {
  it("test 候補 path を併記して human readable に整形", () => {
    const msg = formatMissingError(["apps/web/src/foo.ts"]);
    expect(msg).toContain("Test file missing");
    expect(msg).toContain("apps/web/src/foo.ts");
    expect(msg).toContain("apps/web/src/foo.test.ts");
    expect(msg).toContain("apps/web/src/foo.test.tsx");
    expect(msg).toContain("coverage-config.ts");
  });
});
