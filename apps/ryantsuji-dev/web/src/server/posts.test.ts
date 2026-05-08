/**
 * `server/posts.ts` の post loader が import.meta.glob 経由で markdown を読み、
 * `listPosts` / `getPostSource` を期待通り提供するかの test。
 *
 * 実 markdown source (apps/ryantsuji-dev/web/content/posts/) を vite が test 実行時にも
 * 同じ glob で inline するので、test は「現在 repo にある投稿が新着順で出るか」
 * という構造仕様を確認する形。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business post loader の構造保証。listPosts が新着順 + draft 除外で返ること、getPostSource が published post 本文を返し draft / 未知 slug で null を返すこと
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import { getPostSource, listPosts } from "./posts.js";

describe("listPosts", () => {
  it("少なくとも 1 件の post を新着順 (publishedAt 降順) で返す", () => {
    const posts = listPosts();
    expect(posts.length).toBeGreaterThanOrEqual(1);
    const dates = posts.map((p) => p.publishedAt);
    const sorted = [...dates].sort((a, b) => b.localeCompare(a));
    expect(dates).toStrictEqual(sorted);
  });

  it("draft: true の post は一切含まれない", () => {
    const posts = listPosts();
    expect(posts.map((p) => p.draft)).toStrictEqual(posts.map(() => false));
  });

  it("各 post の slug / title / publishedAt が schema 準拠", () => {
    for (const p of listPosts()) {
      expect(p.slug).toMatch(/^[\w-]+$/);
      expect(p.title.length).toBeGreaterThan(0);
      expect(p.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
    }
  });
});

describe("getPostSource", () => {
  it("既存 published slug で markdown 全文 (frontmatter 込み) を返す", () => {
    const slug = listPosts()[0].slug;
    const source = getPostSource(slug);
    expect(source).toMatch(/^---\n/);
    expect(source).toMatch(/\n---\n/);
  });

  it("存在しない slug で null", () => {
    expect(getPostSource("does-not-exist-anywhere")).toBeNull();
  });

  it("draft post の slug でも null (公開経路から漏らさない)", () => {
    // _draft-example.md は frontmatter で `draft: true` を持つ
    expect(getPostSource("_draft-example")).toBeNull();
  });
});
