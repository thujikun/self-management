/**
 * `/posts/$slug` — 投稿詳細 page。markdown render + engagement (views / likes / comments)。
 *
 * loader は **renderPost → loadEngagement の serial 化**で動く:
 * (frontmatter が engagement の post upsert に必要なため Promise.all 不可)
 * - `renderPostServer` — slug → renderMarkdown (rsc env のみで shiki/unified を bundle)
 * - `loadEngagementServer` — view count を +1 + likes summary + comments list を 1 まとめ取得
 *
 * client の mutation (like toggle / comment 投稿) は `toggleLikeServer` / `addCommentServer`
 * を `useServerFn` で叩く。auth gate は server 側 (`getSessionFromHeaders`) で実行され、
 * 未認証は明示的に reject (UI はその前に sign-in CTA を出す)。
 *
 * 404 (slug 不在 or draft) は `notFound()` で boundary に倒す。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 投稿詳細 route。markdown render + engagement (views/likes/comments) を 1 SSR loader で並列取得し、client の mutation (like toggle / comment 投稿) を server fn 経由で実行する。auth gate は server 側で行い、未認証経路は sign-in CTA を表示
 * @graph-connects tanstack-router [provides] /posts/$slug route
 * @graph-connects tanstack-start [provides] createServerFn で renderMarkdown / engagement DB ops を rsc env に閉じ込める
 * @graph-connects content [calls] @self/content の renderMarkdown で source → RenderedDoc 変換 (server-only)
 * @graph-connects content [embeds] engagement.ts 経由で posts/likes/comments/view_counts を Drizzle 経由で読み書き
 * @graph-connects better-auth [calls] getSessionFromHeaders で current user を解決して like/comment を gate
 */

import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { createServerFn, useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { z } from "zod";

import { useSession } from "../../lib/auth-client.js";
import { PostBody } from "../../server-components/PostBody.js";
import { type CommentView } from "../../server/engagement.js";
import type { Lang } from "../../server/i18n.js";

import {
  runAddComment,
  runLoadEngagement,
  runRenderPost,
  runToggleLike,
} from "./$slug.server.js";

/** @graph-connects none */
const SlugSchema = z.string().min(1);

/**
 * `?lang=en|ja` で override (一覧側と同じ仕様)。invalid 値は捨てて
 * Accept-Language fallback に任せる。
 *
 * @graph-connects none
 */
const SearchSchema = z.object({
  lang: z.enum(["en", "ja"]).optional(),
});

/**
 * renderPost server fn の input schema。slug + override lang。lang は
 * server 側で `Accept-Language` と組合せて `pickLang` で確定する。
 *
 * @graph-connects none
 */
const RenderInputSchema = z.object({
  slug: z.string().min(1),
  override: z.enum(["en", "ja"]).optional(),
});

/**
 * comment 投稿 input。slug + body を受け、body は server 側でも `validateCommentBody` で
 * trim / 上限 check が走る (client 側でも同等の check を出す UX)。
 *
 * @graph-connects none
 */
const CommentInputSchema = z.object({
  slug: z.string().min(1),
  body: z.string().min(1).max(4000),
});

/**
 * loadEngagement 用の input schema。slug + post meta (title / publishedAt) を受ける。
 * post meta は `posts` 行の upsert に使う (FK target 確保)。
 *
 * @graph-connects none
 */
const EngagementInputSchema = z.object({
  slug: z.string().min(1),
  post: z.object({
    title: z.string().min(1),
    publishedAt: z.string().min(1),
  }),
});

/**
 * server function: slug + override lang → markdown source 取得 (en/ja variant 解決) →
 * renderMarkdown で render。lang は server で Accept-Language と組合せて確定する。
 * shiki / unified の重 dep は `runRenderPost` 経由 = rsc env のみに bundle される。
 *
 * @graph-connects content [calls] runRenderPost → getPostSource + renderMarkdown
 */
const renderPostServer = createServerFn()
  .inputValidator((data: unknown) => RenderInputSchema.parse(data))
  .handler(async ({ data }) => runRenderPost(data.slug, data.override as Lang | undefined));

/**
 * server function: slug → view +1 + like summary + comments list。
 * SSR loader で 1 回だけ呼ばれる (= 1 view = 1 increment)。client navigate でも呼ばれるため
 * 明示的に SSR 限定にしたい場合は別経路を考える (今回は spam リスク無視で全 view 加算)。
 *
 * @graph-connects content [calls] runLoadEngagement へ委譲
 */
const loadEngagementServer = createServerFn()
  .inputValidator((data: unknown) => EngagementInputSchema.parse(data))
  .handler(async ({ data, context }) => runLoadEngagement(context.env, data));

/**
 * server function: like を toggle。auth 必須。未認証で呼ばれたら UNAUTHENTICATED を throw。
 *
 * @graph-connects content [calls] runToggleLike へ委譲
 */
const toggleLikeServer = createServerFn()
  .inputValidator((data: unknown) => SlugSchema.parse(data))
  .handler(async ({ data: slug, context }) => runToggleLike(context.env, slug));

/**
 * server function: comment 投稿。auth 必須。空 body / 上限超は server 側でも reject。
 *
 * @graph-connects content [calls] runAddComment へ委譲
 */
const addCommentServer = createServerFn()
  .inputValidator((data: unknown) => CommentInputSchema.parse(data))
  .handler(async ({ data, context }) => runAddComment(context.env, data));

/** @graph-connects tanstack-router [provides] /posts/$slug route */
export const Route = createFileRoute("/posts/$slug")({
  validateSearch: SearchSchema,
  loaderDeps: ({ search }) => ({ override: search.lang }),
  loader: async ({ params, deps }) => {
    // renderPost を先に解決して frontmatter (title / publishedAt) を取り出し、
    // posts 行の upsert に使う。Promise.all で並列化できない (engagement が
    // frontmatter に依存) ので serial。lang は server 側で確定。
    const doc = await renderPostServer({ data: { slug: params.slug, override: deps.override } });
    const engagement = await loadEngagementServer({
      data: {
        slug: params.slug,
        post: { title: doc.frontmatter.title, publishedAt: doc.frontmatter.publishedAt },
      },
    });
    return { ...doc, engagement };
  },
  component: PostDetail,
});

/** @graph-connects none */
function PostDetail() {
  const { html, frontmatter, headings, readingTimeMinutes, engagement, servedLang, availableLangs } =
    Route.useLoaderData();
  const { slug } = Route.useParams();
  return (
    <main className="post-detail" lang={servedLang}>
      <nav className="post-detail__crumbs">
        <Link to="/posts">← all posts</Link>
      </nav>
      <header className="post-detail__header">
        <h1>{frontmatter.title}</h1>
        <PostLangSwitcher slug={slug} servedLang={servedLang} availableLangs={availableLangs} />
        <p className="post-detail__meta">
          <time dateTime={frontmatter.publishedAt}>{frontmatter.publishedAt}</time>
          <span className="post-detail__divider" aria-hidden="true">
            ·
          </span>
          <span>{readingTimeMinutes} min read</span>
          <span className="post-detail__divider" aria-hidden="true">
            ·
          </span>
          <span className="post-detail__views">{engagement.viewCount} views</span>
          {frontmatter.tags.length > 0 ? (
            <>
              <span className="post-detail__divider" aria-hidden="true">
                ·
              </span>
              <ul className="post-detail__tags">
                {frontmatter.tags.map((tag) => (
                  <li key={tag}>#{tag}</li>
                ))}
              </ul>
            </>
          ) : null}
        </p>
      </header>
      {headings.length > 1 ? (
        <aside className="post-detail__toc" aria-label="目次">
          <h2>目次</h2>
          <ol>
            {headings.map((h) => (
              <li key={h.id} data-level={h.level}>
                <a href={`#${h.id}`}>{h.text}</a>
              </li>
            ))}
          </ol>
        </aside>
      ) : null}
      <PostBody html={html} />
      <EngagementSection
        slug={slug}
        initialLikes={engagement.likes}
        initialComments={engagement.comments}
      />
    </main>
  );
}

/**
 * 詳細 page の language toggle。`?lang=` query を切替える。利用可能な lang のみ
 * 表示し、不在 lang はそもそも button を出さない (= EN-only post には JP button
 * を出さない方針、user に空クリックさせない)。
 *
 * @graph-connects tanstack-router [calls] Link で /posts/$slug?lang= に navigate
 */
function PostLangSwitcher({
  slug,
  servedLang,
  availableLangs,
}: {
  slug: string;
  servedLang: Lang;
  availableLangs: Lang[];
}) {
  if (availableLangs.length <= 1) return null;
  return (
    <nav className="lang-switcher" aria-label="language">
      {availableLangs.map((l) => (
        <Link
          key={l}
          to="/posts/$slug"
          params={{ slug }}
          search={(prev) => ({ ...prev, lang: l })}
          className={
            l === servedLang
              ? "lang-switcher__btn lang-switcher__btn--active"
              : "lang-switcher__btn"
          }
        >
          {l.toUpperCase()}
        </Link>
      ))}
    </nav>
  );
}

/**
 * `useServerFn` で得る型を再利用するため一回だけ抽出。test 用 fake にも同 shape を要求できる。
 *
 * @graph-connects none
 */
type ToggleLikeFn = (args: { data: string }) => Promise<{ liked: boolean; count: number }>;
/** @graph-connects none */
type AddCommentFn = (args: { data: { slug: string; body: string } }) => Promise<CommentView>;

/**
 * like ボタン押下の business logic。React state を持たず、結果を `{ ok, likes }` /
 * `{ ok, error }` で返す pure な shape にして test 容易に。
 *
 * @graph-connects content [calls] toggleLikeFn (server fn 経由)
 */
export async function executeLikeAction(
  toggleLikeFn: ToggleLikeFn,
  slug: string,
): Promise<{ ok: true; likes: { liked: boolean; count: number } } | { ok: false; error: string }> {
  try {
    const next = await toggleLikeFn({ data: slug });
    return { ok: true, likes: next };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "like failed" };
  }
}

/**
 * comment 投稿の business logic。空 body は明示エラー、server 側 throw も含めて
 * `{ ok, comment }` / `{ ok, error }` に集約。
 *
 * @graph-connects content [calls] addCommentFn (server fn 経由)
 */
export async function executeAddCommentAction(
  addCommentFn: AddCommentFn,
  args: { slug: string; body: string },
): Promise<{ ok: true; comment: CommentView } | { ok: false; error: string }> {
  const trimmed = args.body.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "コメントを入力してください" };
  }
  try {
    const created = await addCommentFn({ data: { slug: args.slug, body: trimmed } });
    return { ok: true, comment: created };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "post failed" };
  }
}

/**
 * like ボタンの click handler を「state setters を引数に受け取る」純関数として切出し。
 * React component 側は単に setters を bind して呼ぶだけ。test では vi.fn の setter を渡して
 * 状態遷移と side-effect を直接 assert する。
 *
 * @graph-connects content [calls] executeLikeAction
 */
export async function dispatchLikeClick(deps: {
  isAuthenticated: boolean;
  submitting: boolean;
  toggleLikeFn: ToggleLikeFn;
  slug: string;
  setSubmitting: (v: boolean) => void;
  setError: (e: string | null) => void;
  setLikes: (l: { liked: boolean; count: number }) => void;
}): Promise<void> {
  if (!deps.isAuthenticated || deps.submitting) return;
  deps.setSubmitting(true);
  deps.setError(null);
  const result = await executeLikeAction(deps.toggleLikeFn, deps.slug);
  if (result.ok) {
    deps.setLikes(result.likes);
  } else {
    deps.setError(result.error);
  }
  deps.setSubmitting(false);
}

/**
 * comment 投稿 form の submit handler。`dispatchLikeClick` と同じく setters 注入式。
 * 成功時は draft を空に戻して route loader を invalidate (view count 等の最新化)。
 *
 * @graph-connects content [calls] executeAddCommentAction
 * @graph-connects tanstack-router [calls] router.invalidate でキャッシュ無効化
 */
export async function dispatchCommentSubmit(deps: {
  isAuthenticated: boolean;
  submitting: boolean;
  draft: string;
  addCommentFn: AddCommentFn;
  slug: string;
  comments: CommentView[];
  setSubmitting: (v: boolean) => void;
  setError: (e: string | null) => void;
  setComments: (next: CommentView[]) => void;
  setDraft: (v: string) => void;
  invalidate: () => void;
}): Promise<void> {
  if (!deps.isAuthenticated || deps.submitting) return;
  deps.setSubmitting(true);
  deps.setError(null);
  const result = await executeAddCommentAction(deps.addCommentFn, {
    slug: deps.slug,
    body: deps.draft,
  });
  if (result.ok) {
    deps.setComments([result.comment, ...deps.comments]);
    deps.setDraft("");
    deps.invalidate();
  } else {
    deps.setError(result.error);
  }
  deps.setSubmitting(false);
}

/**
 * post 末尾の engagement 領域。like 押下 + comment 投稿の client 側 UI を持つ。
 * 未認証時は sign-in CTA を出すだけで mutation は飛ばさない。
 *
 * @graph-connects better-auth [calls] useSession で auth state を取得
 */
export function EngagementSection({
  slug,
  initialLikes,
  initialComments,
}: {
  slug: string;
  initialLikes: { count: number; liked: boolean };
  initialComments: CommentView[];
}) {
  const { data: session } = useSession();
  const router = useRouter();
  const toggleLikeFn = useServerFn(toggleLikeServer);
  const addCommentFn = useServerFn(addCommentServer);

  const [likes, setLikes] = useState(initialLikes);
  const [comments, setComments] = useState(initialComments);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAuthenticated = !!session?.user;

  const onLike = () =>
    dispatchLikeClick({
      isAuthenticated,
      submitting,
      toggleLikeFn,
      slug,
      setSubmitting,
      setError,
      setLikes,
    });

  const onSubmitComment = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    return dispatchCommentSubmit({
      isAuthenticated,
      submitting,
      draft,
      addCommentFn,
      slug,
      comments,
      setSubmitting,
      setError,
      setComments,
      setDraft,
      invalidate: () => router.invalidate(),
    });
  };

  return (
    <section className="engagement" aria-label="engagement">
      <div className="engagement__likes">
        <button
          type="button"
          className="like-button"
          onClick={onLike}
          disabled={!isAuthenticated || submitting}
          aria-pressed={likes.liked}
          aria-label={likes.liked ? "unlike" : "like"}
        >
          <span aria-hidden="true">{likes.liked ? "♥" : "♡"}</span>
          <span className="like-button__count">{likes.count}</span>
        </button>
        {!isAuthenticated ? (
          <Link
            to="/sign-in"
            search={{ redirect: `/posts/${slug}` }}
            className="engagement__signin"
          >
            sign in to like / comment
          </Link>
        ) : null}
      </div>

      <h2 className="comments__heading">comments ({comments.length})</h2>
      {isAuthenticated ? (
        <form className="comments__form" onSubmit={onSubmitComment}>
          <label htmlFor="comment-body" className="visually-hidden">
            comment
          </label>
          <textarea
            id="comment-body"
            className="comments__input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="思ったことを書いてください"
            rows={3}
            maxLength={4000}
            disabled={submitting}
          />
          <button
            type="submit"
            className="comments__submit"
            disabled={submitting || draft.trim().length === 0}
          >
            {submitting ? "posting..." : "post"}
          </button>
        </form>
      ) : null}
      {error ? (
        <p className="comments__error" role="alert">
          {error}
        </p>
      ) : null}

      {comments.length > 0 ? (
        <ol className="comments__list">
          {comments.map((c) => (
            <li key={c.id} className="comments__item">
              <header className="comments__meta">
                <span className="comments__author">{c.authorName}</span>
                <time dateTime={c.createdAt} className="comments__date">
                  {c.createdAt.slice(0, 10)}
                </time>
              </header>
              <p className="comments__body">{c.body}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="comments__empty">まだコメントはありません。</p>
      )}
    </section>
  );
}
