/**
 * `PostCard` の view-level unit test。
 *
 * 一覧側で `_` prefix slug を除外する方針にしたため、 production data に
 * `servedLang !== requestedLang` の post は存在しなくなる。 fallback hint (showing
 * EN — JP not available 等) の JSX 経路は本 unit test でのみ実 execute される。
 *
 * `Link` は router context 必須なので、本 test では anchor に差し替えて isolation する
 * (route 全体の SSR は `index.test.tsx` 側でカバー)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business PostCard 単体の render 分岐 test。requestedLang !== servedLang のとき fallback hint 出現、一致時は非表示、tags / summary の有無で list / paragraph branch を踏むことを確認
 * @graph-connects none
 */

import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// `Link` は router context 必須。unit test では plain anchor に差し替えて、
// PostCard の render branch だけを切離して assert する。
// `vi.mock` は vitest が import より前に hoist するので、本 file 内の以降の
// import / 動的アクセスは全て mock 後の module を参照する。
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({
      to,
      params,
      className,
      children,
    }: {
      to: string;
      params?: Record<string, string>;
      className?: string;
      children?: ReactNode;
    }) => {
      const href =
        typeof to === "string"
          ? to.replace(/\$(\w+)/g, (_match, key: string) => params?.[key] ?? "")
          : "/";
      return createElement("a", { href, className }, children);
    },
  };
});

import type { PostListItem } from "../../server/posts.js";
import { PostCard } from "./index.js";

function makePost(overrides: Partial<PostListItem> = {}): PostListItem {
  return {
    slug: "sample",
    title: "Sample Title",
    publishedAt: "2026-05-10",
    tags: [],
    draft: false,
    lang: "en",
    availableLangs: ["en"],
    servedLang: "en",
    ...overrides,
  } satisfies PostListItem;
}

describe("PostCard", () => {
  it("requestedLang !== servedLang で fallback hint を出す (ja request, en serve)", () => {
    const post = makePost({ availableLangs: ["en"], servedLang: "en" });
    const html = renderToString(createElement(PostCard, { post, requestedLang: "ja" }));
    expect(html).toMatch(/class="post-card__fallback-note"[^>]*lang="en"/);
    expect(html).toMatch(/showing\s*(?:<!--\s*-->)?EN(?:<!--\s*-->)?\s*—\s*(?:<!--\s*-->)?JA/);
  });

  it("requestedLang === servedLang のとき fallback hint は出さない", () => {
    const post = makePost({ availableLangs: ["en", "ja"], servedLang: "en" });
    const html = renderToString(createElement(PostCard, { post, requestedLang: "en" }));
    expect(html).not.toMatch(/post-card__fallback-note/);
  });

  it("tags 0 件 / summary 無しで tag-list / summary を出さない (null branch)", () => {
    const post = makePost({ tags: [], summary: undefined });
    const html = renderToString(createElement(PostCard, { post, requestedLang: "en" }));
    expect(html).not.toMatch(/post-card__tags/);
    expect(html).not.toMatch(/post-card__summary/);
  });

  it("tags + summary ありで tag-list / summary を出す", () => {
    const post = makePost({ tags: ["rsc", "typescript"], summary: "short summary" });
    const html = renderToString(createElement(PostCard, { post, requestedLang: "en" }));
    expect(html).toMatch(/<p class="post-card__summary">short summary<\/p>/);
    // React SSR は text 隣接 child 間に `<!-- -->` separator を挟むため、`#` と tag 名の
    // 間に comment が入る可能性も許容する正規表現で固定する。
    expect(html).toMatch(/<li class="post-card__tag">#(?:<!--\s*-->)?rsc<\/li>/);
    expect(html).toMatch(/<li class="post-card__tag">#(?:<!--\s*-->)?typescript<\/li>/);
  });

  it("servedLang の lang badge に --served modifier が付き、他 lang badge には付かない", () => {
    const post = makePost({ availableLangs: ["en", "ja"], servedLang: "ja" });
    const html = renderToString(createElement(PostCard, { post, requestedLang: "ja" }));
    expect(html).toMatch(/<li class="post-card__lang">EN<\/li>/);
    expect(html).toMatch(/<li class="post-card__lang post-card__lang--served">JA<\/li>/);
  });
});
