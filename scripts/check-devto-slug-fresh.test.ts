/*
 * check-devto-slug-fresh の pure logic test。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business devto-slug-fresh gate の pure logic 単体テスト。-temp-slug- 残留 + publish 過ぎた組み合わせのみ violation、それ以外 (publish 前 / slug 未設定 / canonical slug) は素通しすることを fixture で機械強制
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import { collectStaleSlugViolations } from "./check-devto-slug-fresh.js";

const NOW = new Date("2026-06-01T00:00:00Z");

describe("collectStaleSlugViolations", () => {
  it("`-temp-slug-` を含み publishAt 過去 = violation", () => {
    const out = collectStaleSlugViolations(
      [
        {
          file: "alpha.en.md",
          devtoSlug: "alpha-foo-bar-temp-slug-12345",
          publishAt: "2026-05-01T00:00:00Z",
        },
      ],
      NOW,
    );
    expect(out).toStrictEqual([
      {
        file: "alpha.en.md",
        slug: "alpha-foo-bar-temp-slug-12345",
        publishAt: "2026-05-01T00:00:00Z",
      },
    ]);
  });

  it("`-temp-slug-` を含むが publishAt が未来 (= まだ draft window) = 素通し", () => {
    const out = collectStaleSlugViolations(
      [
        {
          file: "beta.en.md",
          devtoSlug: "beta-temp-slug-99999",
          publishAt: "2026-12-31T00:00:00Z",
        },
      ],
      NOW,
    );
    expect(out).toStrictEqual([]);
  });

  it("canonical slug (= -temp-slug- 無し) は publishAt 関係なく素通し", () => {
    const out = collectStaleSlugViolations(
      [
        {
          file: "gamma.en.md",
          devtoSlug: "gamma-canonical-slug-3lfa",
          publishAt: "2026-05-01T00:00:00Z",
        },
      ],
      NOW,
    );
    expect(out).toStrictEqual([]);
  });

  it("devtoSlug 未設定 (= dev.to 未配信 post) は素通し", () => {
    const out = collectStaleSlugViolations(
      [
        { file: "delta.en.md", devtoSlug: undefined, publishAt: "2026-05-01T00:00:00Z" },
        { file: "epsilon.en.md", publishAt: "2026-05-01T00:00:00Z" },
      ],
      NOW,
    );
    expect(out).toStrictEqual([]);
  });

  it("publishAt 未設定は素通し (= 別 gate で検出されるべき不正値)", () => {
    const out = collectStaleSlugViolations(
      [{ file: "zeta.en.md", devtoSlug: "zeta-temp-slug-11" }],
      NOW,
    );
    expect(out).toStrictEqual([]);
  });

  it("publishAt parse 失敗 (= NaN) は素通し (= 別 gate で検出されるべき不正値)", () => {
    const out = collectStaleSlugViolations(
      [{ file: "eta.en.md", devtoSlug: "eta-temp-slug-1", publishAt: "not-a-date" }],
      NOW,
    );
    expect(out).toStrictEqual([]);
  });

  it("複数 post を渡して violation のみ抽出", () => {
    const out = collectStaleSlugViolations(
      [
        {
          file: "stale1.en.md",
          devtoSlug: "stale1-temp-slug-1",
          publishAt: "2026-05-01T00:00:00Z",
        },
        {
          file: "fresh.en.md",
          devtoSlug: "fresh-canonical-1abc",
          publishAt: "2026-05-01T00:00:00Z",
        },
        {
          file: "stale2.en.md",
          devtoSlug: "stale2-temp-slug-2",
          publishAt: "2026-05-15T00:00:00Z",
        },
      ],
      NOW,
    );
    expect(out.map((v) => v.file)).toStrictEqual(["stale1.en.md", "stale2.en.md"]);
  });
});
