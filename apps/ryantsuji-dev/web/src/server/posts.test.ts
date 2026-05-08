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
 * @graph-business post loader の構造保証。listPosts が新着順 + draft 除外で返ること、getPostSource が slug → 全文 を返し未知 slug で null を返すこと、frontmatter parse error を露出させること
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import { getPostSource, listPosts } from "./posts.js";

describe("listPosts", () => {
  it("少なくとも 1 件の post を新着順 (publishedAt 降順) で返す", () => {
    const posts = listPosts();
    expect(posts.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < posts.length; i++) {
      expect(posts[i - 1].publishedAt >= posts[i].publishedAt).toBe(true);
    }
  });

  it("draft: true の post は除外される", () => {
    const posts = listPosts();
    expect(posts.every((p) => p.draft === false)).toBe(true);
  });

  it("各 post に slug / title / publishedAt が必ず付く", () => {
    const posts = listPosts();
    for (const p of posts) {
      expect(p.slug).toMatch(/^[\w-]+$/);
      expect(p.title.length).toBeGreaterThan(0);
      expect(p.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
    }
  });
});

describe("getPostSource", () => {
  it("既存 slug で markdown 全文 (frontmatter 込み) を返す", () => {
    const slug = listPosts()[0].slug;
    const source = getPostSource(slug);
    expect(source).not.toBeNull();
    expect(source?.startsWith("---\n")).toBe(true);
  });

  it("存在しない slug で null", () => {
    expect(getPostSource("does-not-exist-anywhere")).toBeNull();
  });
});
