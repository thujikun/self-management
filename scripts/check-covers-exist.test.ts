/**
 * `check-covers-exist` pure logic の test。`findMissingCovers` が
 *   - `_` 始まり slug (test fixture) を skip すること
 *   - exists 述語が false を返した slug × lang を漏れなく列挙すること
 *   - exists 述語に渡される path が `coverPublicPath(slug, lang)` と一致すること
 * を inline で固定する。
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business covers-exist gate の pure logic test。fixture skip / 欠落 enumeration / public path 一致を inline snapshot で固定し、convention 変更時の double-source-of-truth drift を即座に検知する
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import { findMissingCovers, type PostEntry } from "./check-covers-exist.js";

describe("findMissingCovers", () => {
  it("全 post の PNG が存在する場合は空配列を返す", () => {
    const posts: PostEntry[] = [
      { slug: "alpha", lang: "en" },
      { slug: "alpha", lang: "ja" },
    ];
    const seen: string[] = [];
    const result = findMissingCovers(posts, (p) => {
      seen.push(p);
      return true;
    });
    expect(result).toStrictEqual([]);
    expect(seen).toStrictEqual([
      "/images/posts/alpha.en.cover.png",
      "/images/posts/alpha.ja.cover.png",
    ]);
  });

  it("一部 PNG が欠けている場合は欠落のみを返す (順序は posts 入力順)", () => {
    const posts: PostEntry[] = [
      { slug: "alpha", lang: "en" },
      { slug: "alpha", lang: "ja" },
      { slug: "beta", lang: "en" },
    ];
    // ja だけ欠けている fake exists 述語
    const result = findMissingCovers(posts, (p) => p !== "/images/posts/alpha.ja.cover.png");
    expect(result).toStrictEqual([
      { slug: "alpha", lang: "ja", publicPath: "/images/posts/alpha.ja.cover.png" },
    ]);
  });

  it("`_` 始まり slug (fixture) は exists を呼ばずに skip", () => {
    const posts: PostEntry[] = [
      { slug: "_minimal-fixture", lang: "en" },
      { slug: "_draft-example", lang: "en" },
      { slug: "real-post", lang: "en" },
    ];
    const seen: string[] = [];
    const result = findMissingCovers(posts, (p) => {
      seen.push(p);
      return true;
    });
    expect(result).toStrictEqual([]);
    // fixture slug は exists 述語を呼ばない (= I/O 無駄打ち防止)
    expect(seen).toStrictEqual(["/images/posts/real-post.en.cover.png"]);
  });

  it("全 PNG 欠落 → 全 entry を返す (順序維持、`_` 始まりは依然 skip)", () => {
    const posts: PostEntry[] = [
      { slug: "_skip-me", lang: "en" },
      { slug: "alpha", lang: "en" },
      { slug: "beta", lang: "ja" },
    ];
    const result = findMissingCovers(posts, () => false);
    expect(result).toStrictEqual([
      { slug: "alpha", lang: "en", publicPath: "/images/posts/alpha.en.cover.png" },
      { slug: "beta", lang: "ja", publicPath: "/images/posts/beta.ja.cover.png" },
    ]);
  });

  it("空 posts 入力 → 空配列 + exists 述語は呼ばれない", () => {
    const seen: string[] = [];
    const result = findMissingCovers([], (p) => {
      seen.push(p);
      return true;
    });
    expect(result).toStrictEqual([]);
    expect(seen).toStrictEqual([]);
  });
});
