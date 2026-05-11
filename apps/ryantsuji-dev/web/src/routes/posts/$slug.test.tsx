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

// DB は test 環境で叩けないので createDbFromProcess を no-op stub に。mockDb は
// toHaveBeenCalledWith の db 引数検証に使う。
const mockDb = {};
vi.mock("../../server/db.js", () => ({
  createDbFromProcess: vi.fn(() => mockDb),
  readDatabaseUrl: vi.fn(() => "postgresql://test"),
}));

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
vi.mock("../../server/engagement.js", () => ({
  loadPostEngagement: (...args: unknown[]) => mockLoadEngagement(...args),
  toggleLike: (...args: unknown[]) => mockToggleLike(...args),
  addComment: (...args: unknown[]) => mockAddComment(...args),
}));

// server/auth の readEnvFromProcess だけ差し替え。他の export (getAuth 等) は actual を継承。
vi.mock("../../server/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/auth.js")>();
  return {
    ...actual,
    readEnvFromProcess: vi.fn(() => ({
      DATABASE_URL: "postgresql://test",
      BETTER_AUTH_SECRET: "x".repeat(32),
      BETTER_AUTH_URL: "http://localhost:3000",
      GITHUB_CLIENT_ID: "g",
      GITHUB_CLIENT_SECRET: "g",
      X_OAUTH2_CLIENT_ID: "x",
      X_OAUTH2_CLIENT_SECRET: "x",
    })),
  };
});

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
    const slug = "hello-world";
    const title = listPosts().find((p) => p.slug === slug)!.title;
    const html = await ssrAt(`/posts/${slug}`);

    expect(html).toMatch(new RegExp(`<h1>${escapeRegex(title)}</h1>`));
    expect(html).toMatch(/<article class="post-body">/);
    expect(html).toMatch(/← all posts/);
    expect(html).toMatch(/\d+(?:<!--\s*-->)?\s*min read/);
    expect(html).toMatch(/<aside class="post-detail__toc"/);
    expect(html).toMatch(/<ul class="post-detail__tags">/);
  });

  it("tags / headings の無い minimal post は TOC + tag list を出さない (null branch)", async () => {
    const slug = "minimal";
    const title = listPosts().find((p) => p.slug === slug)!.title;
    const html = await ssrAt(`/posts/${slug}`);

    expect(html).toMatch(new RegExp(`<h1>${escapeRegex(title)}</h1>`));
    expect(html).toMatch(/<article class="post-body">/);
    expect(html).not.toMatch(/<aside class="post-detail__toc"/);
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

  it("view count を post header の meta に表示", async () => {
    mockLoadEngagement.mockResolvedValue({
      viewCount: "42",
      likes: { count: 7, liked: false },
      comments: [],
    });
    const html = await ssrAt("/posts/minimal");
    expect(html).toMatch(/<span class="post-detail__views">42(?:<!--\s*-->)?\s*views<\/span>/);
  });

  it("likes count + 未認証で disabled like button + sign-in CTA", async () => {
    mockLoadEngagement.mockResolvedValue({
      viewCount: "0",
      likes: { count: 7, liked: false },
      comments: [],
    });
    const html = await ssrAt("/posts/minimal");
    expect(html).toMatch(/<button[^>]*class="like-button"[^>]*disabled/);
    expect(html).toMatch(/aria-pressed="false"/);
    expect(html).toMatch(/<span class="like-button__count">7<\/span>/);
    expect(html).toMatch(/sign in to like \/ comment/);
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
        },
        {
          id: "c1",
          authorName: "Bob",
          authorId: "u2",
          body: "thanks!",
          createdAt: "2026-05-08T00:00:00.000Z",
        },
      ],
    });
    const html = await ssrAt("/posts/minimal");
    expect(html).toMatch(/comments\s*\((?:<!--\s*-->)?\s*2\s*(?:<!--\s*-->)?\)/);
    expect(html).toMatch(/<span class="comments__author">Alice<\/span>/);
    expect(html).toMatch(/<p class="comments__body">great post<\/p>/);
    expect(html).toMatch(/<span class="comments__author">Bob<\/span>/);
    // Alice (c2) が Bob (c1) より先に出る
    expect(html.indexOf("Alice")).toBeLessThan(html.indexOf("Bob"));
  });

  it("comments 0 件 → 空 placeholder を出し、form は出さない (未認証なので)", async () => {
    mockLoadEngagement.mockResolvedValue({
      viewCount: "0",
      likes: { count: 0, liked: false },
      comments: [],
    });
    const html = await ssrAt("/posts/minimal");
    expect(html).toMatch(/まだコメントはありません/);
    expect(html).not.toMatch(/<form class="comments__form"/);
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
    await ssrAt("/posts/minimal");
    expect(mockGetSession).toHaveBeenCalled();
    expect(mockLoadEngagement).toHaveBeenCalledWith(mockDb, {
      slug: "minimal",
      identifier: "u1",
      bumpView: true,
    });
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
    it("未認証 (session=null) → identifier=null で loadPostEngagement", async () => {
      mockGetSession.mockResolvedValue(null);
      mockLoadEngagement.mockResolvedValue({
        viewCount: "1",
        likes: { count: 0, liked: false },
        comments: [],
      });
      const out = await runLoadEngagement("foo");
      expect(out.viewCount).toStrictEqual("1");
      expect(mockLoadEngagement).toHaveBeenCalledWith(mockDb, {
        slug: "foo",
        identifier: null,
        bumpView: true,
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
      await runLoadEngagement("bar");
      expect(mockLoadEngagement).toHaveBeenCalledWith(mockDb, {
        slug: "bar",
        identifier: "u42",
        bumpView: true,
      });
    });
  });

  describe("runToggleLike", () => {
    it("未認証 → UNAUTHENTICATED throw", async () => {
      mockGetSession.mockResolvedValue(null);
      await expect(runToggleLike("foo")).rejects.toThrow(/UNAUTHENTICATED/);
      expect(mockToggleLike).not.toHaveBeenCalled();
    });

    it("認証済み → toggleLike(db, slug, userId)", async () => {
      mockGetSession.mockResolvedValue({
        user: { id: "u1", email: "x@y", name: "X", image: null },
        session: { id: "s", userId: "u1", expiresAt: new Date("2099-01-01") },
      });
      mockToggleLike.mockResolvedValue({ liked: true, count: 1 });
      const out = await runToggleLike("foo");
      expect(out).toStrictEqual({ liked: true, count: 1 });
      expect(mockToggleLike).toHaveBeenCalledWith(mockDb, "foo", "u1");
    });
  });

  describe("runAddComment", () => {
    it("未認証 → UNAUTHENTICATED throw", async () => {
      mockGetSession.mockResolvedValue(null);
      await expect(runAddComment({ slug: "foo", body: "hi" })).rejects.toThrow(/UNAUTHENTICATED/);
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
      });
      await runAddComment({ slug: "foo", body: "great" });
      expect(mockAddComment).toHaveBeenCalledWith(mockDb, {
        slug: "foo",
        authorId: "u1",
        authorName: "Ryan",
        authorEmail: "ryan@example.com",
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
  };

  it("成功 → { ok: true, comment }、body は trim される", async () => {
    const fn = vi.fn().mockResolvedValue(created);
    const out = await executeAddCommentAction(fn, { slug: "foo", body: "  hello  " });
    expect(out).toStrictEqual({ ok: true, comment: created });
    expect(fn).toHaveBeenCalledWith({ data: { slug: "foo", body: "hello" } });
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
      { id: "c0", authorName: "X", authorId: "ux", body: "old", createdAt: "2026-05-09T00:00:00Z" },
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
    mockInvalidate.mockReset();
  });

  afterEach(() => {
    useSessionSpy.mockReset();
    document.body.innerHTML = "";
  });

  /**
   * `EngagementSection` を実 DOM に mount し、Promise queue を flush するための helper。
   * client-only test なので Link は使わない branch (= 認証済み) を踏む。
   */
  async function mount(props: Parameters<typeof EngagementSection>[0]): Promise<{
    root: ReturnType<typeof import("react-dom/client").createRoot>;
    container: HTMLElement;
  }> {
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(EngagementSection, props));
    });
    return { root, container };
  }

  it("like button click → toggleLikeFn が呼ばれて UI が更新される", async () => {
    mockToggleLike.mockResolvedValue({ liked: true, count: 1 });
    const { container, root } = await mount({
      slug: "foo",
      initialLikes: { count: 0, liked: false },
      initialComments: [],
    });
    const btn = container.querySelector(".like-button") as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.getAttribute("aria-pressed")).toStrictEqual("false");

    const { act } = await import("react");
    await act(async () => {
      btn.click();
    });

    expect(mockToggleLike).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".like-button")?.getAttribute("aria-pressed")).toStrictEqual(
      "true",
    );
    expect(container.querySelector(".like-button__count")?.textContent).toStrictEqual("1");

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
    };
    mockAddComment.mockResolvedValue(created);
    const { container, root } = await mount({
      slug: "foo",
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
      initialLikes: { count: 0, liked: false },
      initialComments: [],
    });
    const btn = container.querySelector(".like-button") as HTMLButtonElement;

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
});

describe("EngagementSection — render branches", () => {
  // useSession を mock。session=null と session=user の両 branch を踏む。
  const useSessionSpy = vi.spyOn(authClient, "useSession");

  afterEach(() => {
    useSessionSpy.mockReset();
  });

  function renderEngagement(
    props: Parameters<typeof EngagementSection>[0],
    session: { user: { id: string; email: string; name: string; image: string | null } } | null,
  ): string {
    useSessionSpy.mockReturnValue({
      data: session,
      isPending: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof authClient.useSession>);
    // Link は router context が無いと throw するので、route render 上での integration は SSR
    // テストに任せ、ここでは createElement で直接 render することで Link を使う branch を踏む。
    // 未認証 branch のみ Link を render するので、認証済み branch のみここで踏む。
    return renderToString(createElement(EngagementSection, props));
  }

  it("認証済み + comments 0 件 → form + empty placeholder + sign-in CTA は出ない", () => {
    const html = renderEngagement(
      {
        slug: "foo",
        initialLikes: { count: 0, liked: false },
        initialComments: [],
      },
      {
        user: { id: "u1", email: "x@y.com", name: "X", image: null },
      },
    );
    expect(html).toMatch(/<form class="comments__form"/);
    expect(html).toMatch(/まだコメントはありません/);
    expect(html).not.toMatch(/sign in to like/);
    // 認証済みなので like button は disabled でない
    expect(html).not.toMatch(/<button[^>]*class="like-button"[^>]*disabled/);
  });

  it("認証済み + 自分が liked=true → aria-pressed=true + ♥ icon", () => {
    const html = renderEngagement(
      {
        slug: "foo",
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
        initialLikes: { count: 1, liked: false },
        initialComments: [
          {
            id: "c1",
            authorName: "Alice",
            authorId: "u1",
            body: "hi",
            createdAt: "2026-05-10T00:00:00Z",
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
