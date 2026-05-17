/**
 * `/posts/$slug` (詳細 page) の SSR test。
 *
 * `RouterProvider` + memory history で具体 slug に navigate し、loader 内の
 * `renderMarkdown` 経由で出る title / readingTime / TOC / body 構造と、
 * engagement (views / likes / comments) の SSR 出力を確認する。
 *
 * DB / auth は test 環境で叩けないため `vi.mock` で server-only module を
 * canned data 返却に差し替える (createServerFn 自体は test-setup.ts で passthrough mock 済)。
 *
 * 出力 HTML は React の hydration marker 込みなので、business substring を
 * `toMatch` regex で固定する形で testing.md の弱い matcher 禁止に従う。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 投稿詳細 route の SSR + engagement SSR 出力の保証。markdown render + view count 表示 + 未認証時 sign-in CTA + 既存 comments 描画を 1 router pass で確認、null branch (tags/headings/comments 不在) と 404 boundary を分岐 case で踏む
 * @graph-connects none
 */

import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderMarkdown } from "@self/content";

import { getRouter } from "../../router.js";
import { listPosts } from "../../server/posts.js";
import * as authClient from "../../lib/auth-client.js";

import {
  EngagementSection,
  PostShareRail,
  buildPostMeta,
  dispatchCommentSubmit,
  dispatchLikeClick,
  executeAddCommentAction,
  executeLikeAction,
} from "./$slug.js";
import { runAddComment, runLoadEngagement, runToggleLike } from "./$slug.server.js";

// `@tanstack/react-start/server` は production runtime (AsyncLocalStorage) に依存するため
// test では空 Headers を返す stub に。createServerFn 自体は test-setup.ts で passthrough mock 済。
vi.mock("@tanstack/react-start/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start/server")>();
  return {
    ...actual,
    getRequestHeaders: () => ({}) as Record<string, string>,
  };
});

// `useRouter` は RouterProvider 配下でしか使えない。component の単独 mount test 用に
// `invalidate()` だけ持つ fake で上書き (test ごとに mock 値を制御したいので関数経由)。
const mockInvalidate = vi.fn();
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useRouter: () =>
      ({ invalidate: mockInvalidate }) as unknown as ReturnType<typeof actual.useRouter>,
  };
});

// DB は test 環境で叩けないので createDbFromEnv を no-op stub に。mockDb は
// toHaveBeenCalledWith の db 引数検証に使う。
const mockDb = {};
vi.mock("../../server/db.js", () => ({
  createDbFromEnv: vi.fn(() => mockDb),
  readDatabaseUrl: vi.fn(() => "postgresql://test"),
}));

// run* 系 server fn body は (env, slug) を受け取る。test では Env binding を fake する。
const TEST_ENV = {
  ASSETS: {} as Fetcher,
  DATABASE_URL: "postgresql://test",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
  GITHUB_CLIENT_ID: "g",
  GITHUB_CLIENT_SECRET: "g",
  X_OAUTH2_CLIENT_ID: "x",
  X_OAUTH2_CLIENT_SECRET: "x",
  GOOGLE_CLIENT_ID: "google",
  GOOGLE_CLIENT_SECRET: "google",
};

// auth session: 既定で未認証 (null) を返す。it ごとに mockReturnValue で session ありに切替可能。
const mockGetSession = vi.fn().mockResolvedValue(null);
vi.mock("../../server/auth-session.js", () => ({
  getSessionFromHeaders: (headers: Headers) => mockGetSession(headers),
}));

// engagement: 既定 = view 0 / likes 0 / comments 空。it ごとに override 可能。
const mockLoadEngagement = vi.fn().mockResolvedValue({
  viewCount: "0",
  likes: { count: 0, liked: false },
  comments: [],
});
const mockToggleLike = vi.fn();
const mockAddComment = vi.fn();
const mockDeleteComment = vi.fn();
vi.mock("../../server/engagement.js", () => ({
  loadPostEngagement: (...args: unknown[]) => mockLoadEngagement(...args),
  toggleLike: (...args: unknown[]) => mockToggleLike(...args),
  addComment: (...args: unknown[]) => mockAddComment(...args),
  deleteComment: (...args: unknown[]) => mockDeleteComment(...args),
}));

async function ssrAt(path: string): Promise<string> {
  const router = getRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  return renderToString(<RouterProvider router={router} />);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * React SSR は `<`, `>`, `&`, `'`, `"` を HTML entity に escape する。比較対象の
 * title が apostrophe や `&` を含むと regex 直比較が壊れるので、entity 化した形に
 * 揃えた上で regex 用に escape する。
 */
function escapeRegexForHtmlBody(s: string): string {
  const entityMap: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#x27;",
  };
  const htmlEscaped = s.replace(/[&<>"']/g, (ch) => entityMap[ch] ?? ch);
  return escapeRegex(htmlEscaped);
}

describe("/posts/$slug — detail (SSR)", () => {
  // shiki / unified の cold-start を吸収 (--coverage 下で 30s 越え対策)
  beforeAll(async () => {
    await renderMarkdown(
      ["---", 'title: "warmup"', 'publishedAt: "2026-05-08"', "---", "warm"].join("\n"),
    );
  }, 60_000);

  beforeEach(() => {
    mockGetSession.mockReset();
    mockGetSession.mockResolvedValue(null);
    mockLoadEngagement.mockReset();
    mockLoadEngagement.mockResolvedValue({
      viewCount: "0",
      likes: { count: 0, liked: false },
      comments: [],
    });
  });

  it("tags / headings 持ち post は title + body + TOC + tag list 込みで SSR される", async () => {
    // dev.to から import した実 post (tags + 多 heading) を fixture 代わりに使う
    const slug = "db-graph-mcp";
    const title = listPosts("en").find((p) => p.slug === slug)!.title;
    const html = await ssrAt(`/posts/${slug}`);

    expect(html).toMatch(new RegExp(`<h1>${escapeRegexForHtmlBody(title)}</h1>`));
    expect(html).toMatch(/<article class="post-body">/);
    expect(html).toMatch(/← all posts/);
    expect(html).toMatch(/\d+(?:<!--\s*-->)?\s*min read/);
    // TOC は PostToc component に切り出されて `post-toc` class を使う (desktop + mobile dialog)
    expect(html).toMatch(/<aside class="post-toc post-toc--desktop"/);
    expect(html).toMatch(/<ul class="post-detail__tags">/);
  });

  it("tags / headings の無い minimal post は TOC + tag list を出さない (null branch)", async () => {
    // `_minimal-fixture` は listPosts から除外される (production 露出を避ける) ので、
    // 一覧 lookup ではなく title を fixture 直書きで参照する。
    const slug = "_minimal-fixture";
    const title = "Minimal post (test fixture)";
    const html = await ssrAt(`/posts/${slug}`);

    expect(html).toMatch(new RegExp(`<h1>${escapeRegexForHtmlBody(title)}</h1>`));
    expect(html).toMatch(/<article class="post-body">/);
    expect(html).not.toMatch(/<aside class="post-toc/);
    expect(html).not.toMatch(/<ul class="post-detail__tags">/);
  });

  it("draft post の slug は notFound boundary に倒される (200 boundary、本文なし)", async () => {
    const html = await ssrAt("/posts/_draft-example");
    expect(html).not.toMatch(/<article class="post-body">/);
    expect(html).not.toMatch(/Draft example/);
  });

  it("存在しない slug は notFound boundary に倒される (post body 不出力)", async () => {
    const html = await ssrAt("/posts/this-slug-does-not-exist");
    expect(html).not.toMatch(/<article class="post-body">/);
    expect(html).not.toMatch(/<h1>/);
  });
});

describe("/posts/$slug — engagement (SSR、未認証)", () => {
  beforeAll(async () => {
    await renderMarkdown(
      ["---", 'title: "warmup"', 'publishedAt: "2026-05-08"', "---", "warm"].join("\n"),
    );
  }, 60_000);

  beforeEach(() => {
    mockGetSession.mockReset();
    mockGetSession.mockResolvedValue(null);
    mockLoadEngagement.mockReset();
  });

  it("view count は loader 経由で取得され DOM に乗らない (header から外した)", async () => {
    // style refresh で view count は post header の表示から外した
    // (PostSharePane の like カウントには残っている)。loader が viewCount を
    // 返している事実は engagement の server fn test 側で担保する。
    mockLoadEngagement.mockResolvedValue({
      viewCount: "42",
      likes: { count: 7, liked: false },
      comments: [],
    });
    const html = await ssrAt("/posts/_minimal-fixture");
    expect(html).not.toMatch(/post-detail__views/);
    // SSR は未認証 default なので like button は PostSharePane の sign-in fallback link に
    // なり like count span は出ない (認証済み branch のみ count を出す設計)
    expect(html).toMatch(/post-share-pane/);
  });

  it("未認証で like button が sign-in CTA fallback + comment textarea + sign-in submit ボタンも出る", async () => {
    mockLoadEngagement.mockResolvedValue({
      viewCount: "0",
      likes: { count: 7, liked: false },
      comments: [],
    });
    const html = await ssrAt("/posts/_minimal-fixture");
    // PostSharePane の like button は未認証時 sign-in に置換される (Link)
    expect(html).toMatch(/post-share-pane__btn--signin/);
    // textarea は常時出す (未認証でも書ける、投稿時に sign-in 求める)
    expect(html).toMatch(/<textarea[^>]*id="comment-body"/);
    expect(html).toMatch(/sign in to post/);
    expect(html).toMatch(/comments__submit--signin/);
  });

  it("既存 comments を新着順で render (mock 順序通り)", async () => {
    mockLoadEngagement.mockResolvedValue({
      viewCount: "0",
      likes: { count: 0, liked: false },
      comments: [
        {
          id: "c2",
          authorName: "Alice",
          authorId: "u1",
          body: "great post",
          createdAt: "2026-05-09T00:00:00.000Z",
          parentCommentId: null,
        },
        {
          id: "c1",
          authorName: "Bob",
          authorId: "u2",
          body: "thanks!",
          createdAt: "2026-05-08T00:00:00.000Z",
          parentCommentId: null,
        },
      ],
    });
    const html = await ssrAt("/posts/_minimal-fixture");
    expect(html).toMatch(/comments\s*\((?:<!--\s*-->)?\s*2\s*(?:<!--\s*-->)?\)/);
    expect(html).toMatch(/<span class="comments__author">Alice<\/span>/);
    expect(html).toMatch(/<p class="comments__body">great post<\/p>/);
    expect(html).toMatch(/<span class="comments__author">Bob<\/span>/);
    // Alice (c2) が Bob (c1) より先に出る
    expect(html.indexOf("Alice")).toBeLessThan(html.indexOf("Bob"));
  });

  it("comments 0 件 → 空 placeholder + form は未認証でも常時出す", async () => {
    mockLoadEngagement.mockResolvedValue({
      viewCount: "0",
      likes: { count: 0, liked: false },
      comments: [],
    });
    const html = await ssrAt("/posts/_minimal-fixture");
    // default lang は en なので英語 placeholder
    expect(html).toMatch(/no comments yet/);
    // form は未認証でも textarea を出すため常時表示
    expect(html).toMatch(/<form class="comments__form"/);
  });
});

describe("/posts/$slug — engagement (SSR、認証済み)", () => {
  beforeAll(async () => {
    await renderMarkdown(
      ["---", 'title: "warmup"', 'publishedAt: "2026-05-08"', "---", "warm"].join("\n"),
    );
  }, 60_000);

  beforeEach(() => {
    mockGetSession.mockReset();
    mockGetSession.mockResolvedValue({
      user: {
        id: "u1",
        email: "ryan@example.com",
        name: "Ryan",
        image: null,
      },
      session: { id: "s1", userId: "u1", expiresAt: new Date("2099-01-01") },
    });
    mockLoadEngagement.mockReset();
    mockLoadEngagement.mockResolvedValue({
      viewCount: "0",
      likes: { count: 0, liked: false },
      comments: [],
    });
  });

  // useSession は client-side hook なので、SSR pass では未認証 path に倒れる
  // (これは仕様: hydration 後に session が解決されて UI が differ する)。
  // ここでは server side の getSessionFromHeaders mock が呼ばれることだけ確認する。
  it("loadEngagementServer は session 経由で identifier=userId を渡す", async () => {
    await ssrAt("/posts/_minimal-fixture");
    expect(mockGetSession).toHaveBeenCalled();
    expect(mockLoadEngagement).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({ slug: "_minimal-fixture", identifier: "u1", bumpView: true }),
    );
  });
});

describe("server fn handlers (run*)", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockLoadEngagement.mockReset();
    mockToggleLike.mockReset();
    mockAddComment.mockReset();
  });

  describe("runLoadEngagement", () => {
    const POST_META = { title: "Hello", publishedAt: "2026-05-10" };

    it("未認証 (session=null) → identifier=null で loadPostEngagement", async () => {
      mockGetSession.mockResolvedValue(null);
      mockLoadEngagement.mockResolvedValue({
        viewCount: "1",
        likes: { count: 0, liked: false },
        comments: [],
      });
      const out = await runLoadEngagement(TEST_ENV, { slug: "foo", post: POST_META });
      expect(out.viewCount).toStrictEqual("1");
      expect(mockLoadEngagement).toHaveBeenCalledWith(mockDb, {
        slug: "foo",
        identifier: null,
        bumpView: true,
        post: POST_META,
      });
    });

    it("認証済み → identifier=user.id で loadPostEngagement", async () => {
      mockGetSession.mockResolvedValue({
        user: { id: "u42", email: "x@y", name: "X", image: null },
        session: { id: "s", userId: "u42", expiresAt: new Date("2099-01-01") },
      });
      mockLoadEngagement.mockResolvedValue({
        viewCount: "5",
        likes: { count: 1, liked: true },
        comments: [],
      });
      await runLoadEngagement(TEST_ENV, { slug: "bar", post: POST_META });
      expect(mockLoadEngagement).toHaveBeenCalledWith(mockDb, {
        slug: "bar",
        identifier: "u42",
        bumpView: true,
        post: POST_META,
      });
    });
  });

  describe("runToggleLike", () => {
    it("未認証 → UNAUTHENTICATED throw", async () => {
      mockGetSession.mockResolvedValue(null);
      await expect(runToggleLike(TEST_ENV, "foo")).rejects.toThrow(/UNAUTHENTICATED/);
      expect(mockToggleLike).not.toHaveBeenCalled();
    });

    it("認証済み → toggleLike(db, slug, userId)", async () => {
      mockGetSession.mockResolvedValue({
        user: { id: "u1", email: "x@y", name: "X", image: null },
        session: { id: "s", userId: "u1", expiresAt: new Date("2099-01-01") },
      });
      mockToggleLike.mockResolvedValue({ liked: true, count: 1 });
      const out = await runToggleLike(TEST_ENV, "foo");
      expect(out).toStrictEqual({ liked: true, count: 1 });
      expect(mockToggleLike).toHaveBeenCalledWith(mockDb, "foo", "u1");
    });
  });

  describe("runAddComment", () => {
    it("未認証 → UNAUTHENTICATED throw", async () => {
      mockGetSession.mockResolvedValue(null);
      await expect(runAddComment(TEST_ENV, { slug: "foo", body: "hi" })).rejects.toThrow(
        /UNAUTHENTICATED/,
      );
      expect(mockAddComment).not.toHaveBeenCalled();
    });

    it("認証済み → addComment(db, args) に session info を渡す", async () => {
      mockGetSession.mockResolvedValue({
        user: { id: "u1", email: "ryan@example.com", name: "Ryan", image: null },
        session: { id: "s", userId: "u1", expiresAt: new Date("2099-01-01") },
      });
      mockAddComment.mockResolvedValue({
        id: "c1",
        authorName: "Ryan",
        authorId: "u1",
        body: "great",
        createdAt: "2026-05-10T00:00:00Z",
        parentCommentId: null,
      });
      await runAddComment(TEST_ENV, { slug: "foo", body: "great" });
      expect(mockAddComment).toHaveBeenCalledWith(mockDb, {
        slug: "foo",
        authorId: "u1",
        authorName: "Ryan",
        authorEmail: "ryan@example.com",
        parentCommentId: null,
        body: "great",
      });
    });
  });
});

describe("executeLikeAction", () => {
  it("成功 → { ok: true, likes }", async () => {
    const fn = vi.fn().mockResolvedValue({ liked: true, count: 5 });
    const out = await executeLikeAction(fn, "foo");
    expect(out).toStrictEqual({ ok: true, likes: { liked: true, count: 5 } });
    expect(fn).toHaveBeenCalledWith({ data: "foo" });
  });

  it("Error throw → { ok: false, error: e.message }", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("server boom"));
    const out = await executeLikeAction(fn, "foo");
    expect(out).toStrictEqual({ ok: false, error: "server boom" });
  });

  it("non-Error throw → fallback message", async () => {
    const fn = vi.fn().mockRejectedValue("string-error");
    const out = await executeLikeAction(fn, "foo");
    expect(out).toStrictEqual({ ok: false, error: "like failed" });
  });
});

describe("executeAddCommentAction", () => {
  const created = {
    id: "c1",
    authorName: "Ryan",
    authorId: "u1",
    body: "hello",
    createdAt: "2026-05-10T00:00:00Z",
    parentCommentId: null,
  };

  it("成功 → { ok: true, comment }、body は trim される", async () => {
    const fn = vi.fn().mockResolvedValue(created);
    const out = await executeAddCommentAction(fn, { slug: "foo", body: "  hello  " });
    expect(out).toStrictEqual({ ok: true, comment: created });
    expect(fn).toHaveBeenCalledWith({
      data: { slug: "foo", body: "hello", parentCommentId: null },
    });
  });

  it("空 body → server を叩かず { ok: false, error: 'コメントを...' }", async () => {
    const fn = vi.fn();
    const out = await executeAddCommentAction(fn, { slug: "foo", body: "   " });
    expect(out).toStrictEqual({ ok: false, error: "コメントを入力してください" });
    expect(fn).not.toHaveBeenCalled();
  });

  it("server throw (Error) → { ok: false, error: e.message }", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("forbidden"));
    const out = await executeAddCommentAction(fn, { slug: "foo", body: "hi" });
    expect(out).toStrictEqual({ ok: false, error: "forbidden" });
  });

  it("non-Error throw → fallback message", async () => {
    const fn = vi.fn().mockRejectedValue("string-error");
    const out = await executeAddCommentAction(fn, { slug: "foo", body: "hi" });
    expect(out).toStrictEqual({ ok: false, error: "post failed" });
  });
});

describe("dispatchLikeClick", () => {
  function makeSetters() {
    return {
      setSubmitting: vi.fn(),
      setError: vi.fn(),
      setLikes: vi.fn(),
    };
  }

  it("未認証 → 即 return、setters は呼ばれない", async () => {
    const setters = makeSetters();
    const fn = vi.fn();
    await dispatchLikeClick({
      isAuthenticated: false,
      submitting: false,
      toggleLikeFn: fn,
      slug: "foo",
      ...setters,
    });
    expect(fn).not.toHaveBeenCalled();
    expect(setters.setSubmitting).not.toHaveBeenCalled();
  });

  it("submitting=true → 重複押下を抑止 (即 return)", async () => {
    const setters = makeSetters();
    const fn = vi.fn();
    await dispatchLikeClick({
      isAuthenticated: true,
      submitting: true,
      toggleLikeFn: fn,
      slug: "foo",
      ...setters,
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it("成功 → setSubmitting(true) → setLikes(next) → setSubmitting(false)", async () => {
    const setters = makeSetters();
    const fn = vi.fn().mockResolvedValue({ liked: true, count: 5 });
    await dispatchLikeClick({
      isAuthenticated: true,
      submitting: false,
      toggleLikeFn: fn,
      slug: "foo",
      ...setters,
    });
    expect(setters.setSubmitting).toHaveBeenNthCalledWith(1, true);
    expect(setters.setError).toHaveBeenCalledWith(null);
    expect(setters.setLikes).toHaveBeenCalledWith({ liked: true, count: 5 });
    expect(setters.setSubmitting).toHaveBeenNthCalledWith(2, false);
  });

  it("失敗 → setError(message) + setLikes は呼ばれない", async () => {
    const setters = makeSetters();
    const fn = vi.fn().mockRejectedValue(new Error("boom"));
    await dispatchLikeClick({
      isAuthenticated: true,
      submitting: false,
      toggleLikeFn: fn,
      slug: "foo",
      ...setters,
    });
    expect(setters.setError).toHaveBeenCalledWith("boom");
    expect(setters.setLikes).not.toHaveBeenCalled();
    expect(setters.setSubmitting).toHaveBeenNthCalledWith(2, false);
  });
});

describe("dispatchCommentSubmit", () => {
  function makeDeps() {
    return {
      setSubmitting: vi.fn(),
      setError: vi.fn(),
      setComments: vi.fn(),
      setDraft: vi.fn(),
      invalidate: vi.fn(),
    };
  }

  const created = {
    id: "c1",
    authorName: "Ryan",
    authorId: "u1",
    body: "hi",
    createdAt: "2026-05-10T00:00:00Z",
    parentCommentId: null,
  };

  it("未認証 → 即 return", async () => {
    const deps = makeDeps();
    const fn = vi.fn();
    await dispatchCommentSubmit({
      isAuthenticated: false,
      submitting: false,
      draft: "x",
      addCommentFn: fn,
      slug: "foo",
      comments: [],
      ...deps,
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it("submitting=true → 即 return", async () => {
    const deps = makeDeps();
    const fn = vi.fn();
    await dispatchCommentSubmit({
      isAuthenticated: true,
      submitting: true,
      draft: "x",
      addCommentFn: fn,
      slug: "foo",
      comments: [],
      ...deps,
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it("成功 → setComments([new, ...prev]) + setDraft('') + invalidate()", async () => {
    const deps = makeDeps();
    const fn = vi.fn().mockResolvedValue(created);
    const prev = [
      {
        id: "c0",
        authorName: "X",
        authorId: "ux",
        body: "old",
        createdAt: "2026-05-09T00:00:00Z",
        parentCommentId: null,
      },
    ];
    await dispatchCommentSubmit({
      isAuthenticated: true,
      submitting: false,
      draft: "hi",
      addCommentFn: fn,
      slug: "foo",
      comments: prev,
      ...deps,
    });
    expect(deps.setComments).toHaveBeenCalledWith([created, prev[0]]);
    expect(deps.setDraft).toHaveBeenCalledWith("");
    expect(deps.invalidate).toHaveBeenCalledTimes(1);
    expect(deps.setError).toHaveBeenCalledWith(null);
  });

  it("空 body → setError('コメントを...') + 投稿しない", async () => {
    const deps = makeDeps();
    const fn = vi.fn();
    await dispatchCommentSubmit({
      isAuthenticated: true,
      submitting: false,
      draft: "   ",
      addCommentFn: fn,
      slug: "foo",
      comments: [],
      ...deps,
    });
    expect(fn).not.toHaveBeenCalled();
    expect(deps.setError).toHaveBeenCalledWith("コメントを入力してください");
    expect(deps.setComments).not.toHaveBeenCalled();
    expect(deps.invalidate).not.toHaveBeenCalled();
  });

  it("server throw → setError(message) + invalidate しない", async () => {
    const deps = makeDeps();
    const fn = vi.fn().mockRejectedValue(new Error("forbidden"));
    await dispatchCommentSubmit({
      isAuthenticated: true,
      submitting: false,
      draft: "hi",
      addCommentFn: fn,
      slug: "foo",
      comments: [],
      ...deps,
    });
    expect(deps.setError).toHaveBeenCalledWith("forbidden");
    expect(deps.setComments).not.toHaveBeenCalled();
    expect(deps.invalidate).not.toHaveBeenCalled();
  });
});

describe("EngagementSection — DOM interaction (happy-dom)", () => {
  // useSession を session 注入で固定するため spy。
  const useSessionSpy = vi.spyOn(authClient, "useSession");

  beforeEach(() => {
    useSessionSpy.mockReturnValue({
      data: { user: { id: "u1", email: "x@y.com", name: "X", image: null } },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof authClient.useSession>);
    mockToggleLike.mockReset();
    mockAddComment.mockReset();
    mockDeleteComment.mockReset();
    mockInvalidate.mockReset();
  });

  afterEach(() => {
    useSessionSpy.mockReset();
    document.body.innerHTML = "";
  });

  /**
   * `PostShareRail` + `EngagementSection` を実 DOM に mount し、Promise queue を
   * flush するための helper。両 component が share/like + comments の DOM を同時
   * 提供することで、share pane を `.post-detail` 直下に lift した後でも既存 test
   * 群が「like ボタンも comment form も同 container 内に存在する」前提で網羅できる。
   */
  async function mount(props: {
    slug: string;
    title: string;
    lang: Parameters<typeof EngagementSection>[0]["lang"];
    initialLikes: { count: number; liked: boolean };
    initialComments: Parameters<typeof EngagementSection>[0]["initialComments"];
  }): Promise<{
    root: ReturnType<typeof import("react-dom/client").createRoot>;
    container: HTMLElement;
  }> {
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(
          "div",
          null,
          createElement(PostShareRail, {
            slug: props.slug,
            title: props.title,
            lang: props.lang,
            initialLikes: props.initialLikes,
          }),
          createElement(EngagementSection, {
            slug: props.slug,
            lang: props.lang,
            initialComments: props.initialComments,
          }),
        ),
      );
    });
    return { root, container };
  }

  it("like button click → toggleLikeFn が呼ばれて UI が更新される", async () => {
    mockToggleLike.mockResolvedValue({ liked: true, count: 1 });
    const { container, root } = await mount({
      slug: "foo",
      title: "foo",
      lang: "en",
      initialLikes: { count: 0, liked: false },
      initialComments: [],
    });
    const btn = container.querySelector(".post-share-pane__btn--like") as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.getAttribute("aria-pressed")).toStrictEqual("false");

    const { act } = await import("react");
    await act(async () => {
      btn.click();
    });

    expect(mockToggleLike).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector(".post-share-pane__btn--like")?.getAttribute("aria-pressed"),
    ).toStrictEqual("true");
    expect(container.querySelector(".post-share-pane__count")?.textContent).toStrictEqual("1");

    await act(async () => {
      root.unmount();
    });
  });

  it("comment form submit → 新しい comment が list に prepend される", async () => {
    const created = {
      id: "c-new",
      authorName: "X",
      authorId: "u1",
      body: "hello",
      createdAt: "2026-05-10T00:00:00Z",
      parentCommentId: null,
    };
    mockAddComment.mockResolvedValue(created);
    const { container, root } = await mount({
      slug: "foo",
      title: "foo",
      lang: "en",
      initialLikes: { count: 0, liked: false },
      initialComments: [],
    });
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    const submitBtn = container.querySelector(".comments__submit") as HTMLButtonElement;

    const { act } = await import("react");
    await act(async () => {
      // happy-dom 側で textarea.value を設定 → React の onChange を触発する input event を bubbling で。
      // React は input event を controlled component の change として拾う。
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(textarea, "hello");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(submitBtn.disabled).toStrictEqual(false);
    await act(async () => {
      submitBtn.click();
    });

    expect(mockAddComment).toHaveBeenCalledTimes(1);
    const author = container.querySelector(".comments__author");
    expect(author?.textContent).toStrictEqual("X");
    const body = container.querySelector(".comments__body");
    expect(body?.textContent).toStrictEqual("hello");

    await act(async () => {
      root.unmount();
    });
  });

  it("空 textarea で submit → submit ボタンが disabled、addComment は呼ばれない", async () => {
    const { container, root } = await mount({
      slug: "foo",
      title: "foo",
      lang: "en",
      initialLikes: { count: 0, liked: false },
      initialComments: [],
    });
    const submit = container.querySelector(".comments__submit") as HTMLButtonElement;
    expect(submit.disabled).toStrictEqual(true);
    expect(mockAddComment).not.toHaveBeenCalled();

    const { act } = await import("react");
    await act(async () => {
      root.unmount();
    });
  });

  it("server failure 時 error 表示 (role=alert)", async () => {
    mockToggleLike.mockRejectedValue(new Error("server boom"));
    const { container, root } = await mount({
      slug: "foo",
      title: "foo",
      lang: "en",
      initialLikes: { count: 0, liked: false },
      initialComments: [],
    });
    const btn = container.querySelector(".post-share-pane__btn--like") as HTMLButtonElement;

    const { act } = await import("react");
    await act(async () => {
      btn.click();
    });

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toStrictEqual("server boom");

    await act(async () => {
      root.unmount();
    });
  });

  it("reply (CommentList 経由) → addComment が parentCommentId 付きで呼ばれ、list に prepend", async () => {
    mockAddComment.mockResolvedValue({
      id: "reply-1",
      authorName: "X",
      authorId: "u1",
      body: "reply!",
      createdAt: "2026-05-11T00:00:00Z",
      parentCommentId: "22222222-2222-2222-2222-222222222222",
    });
    const { container, root } = await mount({
      slug: "foo",
      title: "foo",
      lang: "en",
      initialLikes: { count: 0, liked: false },
      initialComments: [
        {
          id: "22222222-2222-2222-2222-222222222222",
          authorName: "Y",
          authorId: "u2",
          body: "top",
          createdAt: "2026-05-10T00:00:00Z",
          parentCommentId: null,
        },
      ],
    });
    // 親 comment の reply button を click (top の comments__action は reply)
    const replyBtn = container.querySelector(
      ".comments__list .comments__action",
    ) as HTMLButtonElement;
    const { act } = await import("react");
    await act(async () => replyBtn.click());
    const replyTextarea = container.querySelector(
      ".comments__form--reply textarea",
    ) as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(replyTextarea, "reply!");
      replyTextarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const submit = container.querySelector(
      ".comments__form--reply .comments__submit",
    ) as HTMLButtonElement;
    await act(async () => submit.click());
    // mock を呼んだ事実を確認
    expect(mockAddComment).toHaveBeenCalled();
    // reply が DOM に出る
    expect(container.querySelector(".comments__item--reply .comments__body")?.textContent).toBe(
      "reply!",
    );
    await act(async () => root.unmount());
  });

  it("delete (CommentList 経由) → deleteComment が呼ばれ list から消える", async () => {
    mockDeleteComment.mockResolvedValue({ deletedId: "11111111-1111-1111-1111-111111111111" });
    const { container, root } = await mount({
      slug: "foo",
      title: "foo",
      lang: "en",
      initialLikes: { count: 0, liked: false },
      initialComments: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          authorName: "X",
          authorId: "u1",
          body: "mine",
          createdAt: "2026-05-10T00:00:00Z",
          parentCommentId: null,
        },
      ],
    });
    const deleteBtn = container.querySelector(".comments__action--danger") as HTMLButtonElement;
    expect(deleteBtn).toBeTruthy();
    const { act } = await import("react");
    await act(async () => deleteBtn.click());
    expect(mockDeleteComment).toHaveBeenCalled();
    expect(container.querySelector(".comments__item")).toBeNull();
    // soft-delete に伴う orphan-promotion + view count の最新化のため router.invalidate
    // が走る (post 経路の invalidate と同経路)
    expect(mockInvalidate).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it("delete が throw した時 error 表示 (catch path)", async () => {
    mockDeleteComment.mockRejectedValue(new Error("delete boom"));
    const { container, root } = await mount({
      slug: "foo",
      title: "foo",
      lang: "en",
      initialLikes: { count: 0, liked: false },
      initialComments: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          authorName: "X",
          authorId: "u1",
          body: "mine",
          createdAt: "2026-05-10T00:00:00Z",
          parentCommentId: null,
        },
      ],
    });
    const deleteBtn = container.querySelector(".comments__action--danger") as HTMLButtonElement;
    const { act } = await import("react");
    await act(async () => deleteBtn.click());
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe("delete boom");
    // catch path では invalidate しない (error 表示のみ)
    expect(mockInvalidate).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("reply が error を返した時 inline error 表示 (CommentList の form 内)", async () => {
    mockAddComment.mockRejectedValue(new Error("reply boom"));
    const { container, root } = await mount({
      slug: "foo",
      title: "foo",
      lang: "en",
      initialLikes: { count: 0, liked: false },
      initialComments: [
        {
          id: "22222222-2222-2222-2222-222222222222",
          authorName: "Y",
          authorId: "u2",
          body: "top",
          createdAt: "2026-05-10T00:00:00Z",
          parentCommentId: null,
        },
      ],
    });
    const { act } = await import("react");
    const replyBtn = container.querySelector(
      ".comments__list .comments__action",
    ) as HTMLButtonElement;
    await act(async () => replyBtn.click());
    const replyTextarea = container.querySelector(
      ".comments__form--reply textarea",
    ) as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(replyTextarea, "hi");
      replyTextarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const submit = container.querySelector(
      ".comments__form--reply .comments__submit",
    ) as HTMLButtonElement;
    await act(async () => submit.click());
    // CommentList 内に role=alert で error が出る
    const alerts = container.querySelectorAll('[role="alert"]');
    expect(Array.from(alerts).some((a) => a.textContent === "reply boom")).toBe(true);
    await act(async () => root.unmount());
  });
});

describe("EngagementSection — render branches", () => {
  // useSession を mock。session=null と session=user の両 branch を踏む。
  const useSessionSpy = vi.spyOn(authClient, "useSession");

  afterEach(() => {
    useSessionSpy.mockReset();
  });

  function renderEngagement(
    props: {
      slug: string;
      title: string;
      lang: Parameters<typeof EngagementSection>[0]["lang"];
      initialLikes: { count: number; liked: boolean };
      initialComments: Parameters<typeof EngagementSection>[0]["initialComments"];
    },
    session: { user: { id: string; email: string; name: string; image: string | null } } | null,
  ): string {
    useSessionSpy.mockReturnValue({
      data: session,
      isPending: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof authClient.useSession>);
    // PostShareRail と EngagementSection を 1 つの fragment にまとめて SSR する。
    // share pane を `.post-detail` 直下に lift した後でも、既存 test 群は like / comment
    // の DOM を同一 HTML 内で expect できる構造を保つ。
    return renderToString(
      createElement(
        "div",
        null,
        createElement(PostShareRail, {
          slug: props.slug,
          title: props.title,
          lang: props.lang,
          initialLikes: props.initialLikes,
        }),
        createElement(EngagementSection, {
          slug: props.slug,
          lang: props.lang,
          initialComments: props.initialComments,
        }),
      ),
    );
  }

  it("認証済み + comments 0 件 → form + empty placeholder + sign-in CTA は出ない", () => {
    const html = renderEngagement(
      {
        slug: "foo",
        title: "foo",
        lang: "en",
        initialLikes: { count: 0, liked: false },
        initialComments: [],
      },
      {
        user: { id: "u1", email: "x@y.com", name: "X", image: null },
      },
    );
    expect(html).toMatch(/<form class="comments__form"/);
    expect(html).toMatch(/no comments yet/);
    expect(html).not.toMatch(/sign in to like/);
    // 認証済みなので like button は disabled でない (PostSharePane の like button)
    expect(html).not.toMatch(/<button[^>]*post-share-pane__btn--like[^>]*disabled/);
  });

  it("認証済み + 自分が liked=true → aria-pressed=true + ♥ icon", () => {
    const html = renderEngagement(
      {
        slug: "foo",
        title: "foo",
        lang: "en",
        initialLikes: { count: 3, liked: true },
        initialComments: [],
      },
      {
        user: { id: "u1", email: "x@y.com", name: "X", image: null },
      },
    );
    expect(html).toMatch(/aria-pressed="true"/);
    expect(html).toMatch(/aria-label="unlike"/);
    expect(html).toMatch(/♥/);
  });

  it("認証済み + 既存 comments あり → list が出る + form も同居", () => {
    const html = renderEngagement(
      {
        slug: "foo",
        title: "foo",
        lang: "en",
        initialLikes: { count: 1, liked: false },
        initialComments: [
          {
            id: "c1",
            authorName: "Alice",
            authorId: "u1",
            body: "hi",
            createdAt: "2026-05-10T00:00:00Z",
            parentCommentId: null,
          },
        ],
      },
      {
        user: { id: "u1", email: "x@y.com", name: "X", image: null },
      },
    );
    expect(html).toMatch(/<form class="comments__form"/);
    expect(html).toMatch(/<span class="comments__author">Alice<\/span>/);
    expect(html).not.toMatch(/まだコメントはありません/);
  });
});

describe("buildPostMeta", () => {
  it("cover 有り EN post: og:image + twitter:image + summary を組む", () => {
    const meta = buildPostMeta({
      slug: "hello",
      title: "Hello World",
      summary: "A test post",
      cover: "/posts/hello.en.cover.png",
      lang: "en",
    });
    const find = (key: string, val: "name" | "property") =>
      meta.find((m) => val in m && (m as Record<string, string>)[val] === key);
    expect(find("og:title", "property")).toStrictEqual({
      property: "og:title",
      content: "Hello World",
    });
    expect(find("og:description", "property")).toStrictEqual({
      property: "og:description",
      content: "A test post",
    });
    expect(find("og:url", "property")).toStrictEqual({
      property: "og:url",
      content: "https://ryantsuji.dev/posts/hello",
    });
    expect(find("og:image", "property")).toStrictEqual({
      property: "og:image",
      content: "https://ryantsuji.dev/posts/hello.en.cover.png",
    });
    expect(find("twitter:card", "name")).toStrictEqual({
      name: "twitter:card",
      content: "summary_large_image",
    });
    expect(find("og:type", "property")).toStrictEqual({
      property: "og:type",
      content: "article",
    });
    // title entry も含む (TanStack head spec 上 `{ title }` で document title 用)
    expect(meta[0]).toStrictEqual({ title: "Hello World — ryantsuji.dev" });
  });

  it("JP post は url に ?lang=ja を付ける", () => {
    const meta = buildPostMeta({
      slug: "hello",
      title: "こんにちは",
      cover: "/posts/hello.ja.cover.png",
      lang: "ja",
    });
    const url = meta.find((m) => "property" in m && m.property === "og:url");
    expect(url).toStrictEqual({
      property: "og:url",
      content: "https://ryantsuji.dev/posts/hello?lang=ja",
    });
  });

  it("cover 無し post: og:image / twitter:image を出さない (root の default に fallback)", () => {
    const meta = buildPostMeta({
      slug: "no-cover",
      title: "No Cover",
      lang: "en",
    });
    expect(meta.find((m) => "property" in m && m.property === "og:image")).toBeUndefined();
    expect(meta.find((m) => "name" in m && m.name === "twitter:image")).toBeUndefined();
    expect(meta.find((m) => "name" in m && m.name === "twitter:card")).toBeUndefined();
  });

  it("summary 無し post は title から description を組み立てる", () => {
    const meta = buildPostMeta({
      slug: "x",
      title: "Plain Title",
      lang: "en",
    });
    const desc = meta.find((m) => "name" in m && m.name === "description");
    expect(desc).toStrictEqual({
      name: "description",
      content: "Plain Title — ryantsuji.dev",
    });
  });
});
