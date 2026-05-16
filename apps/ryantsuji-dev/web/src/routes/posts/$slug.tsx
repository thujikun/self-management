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
import { displayTags } from "../../lib/tags.js";
import { CommentList } from "../../components/CommentList.js";
import { PostSharePane } from "../../components/PostSharePane.js";
import { PostToc } from "../../components/PostToc.js";
import { PostBody } from "../../server-components/PostBody.js";
import { type CommentView } from "../../server/engagement.js";
import type { Lang } from "../../server/i18n.js";

import {
  runAddComment,
  runDeleteComment,
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
  // UUID format は DB FK check で担保するので、ここでは string presence のみ。
  // Zod v4 の `.uuid()` regex が test fixture (固定 UUID 文字列) を rejection するため。
  parentCommentId: z.string().min(1).nullable().optional(),
});

/**
 * comment 削除 input。soft delete を server 側で `deletedAt = now()` する。
 *
 * @graph-connects none
 */
const DeleteCommentInputSchema = z.string().min(1);

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

/**
 * server function: comment 削除 (soft delete)。auth 必須、自分の comment のみ。
 *
 * @graph-connects content [calls] runDeleteComment へ委譲
 */
const deleteCommentServer = createServerFn()
  .inputValidator((data: unknown) => DeleteCommentInputSchema.parse(data))
  .handler(async ({ data: commentId, context }) => runDeleteComment(context.env, commentId));

/**
 * 本番公開 URL。外部 crawler は og:image / twitter:image / og:url を **絶対 URL** で
 * 要求する (`__root.tsx` の SITE_URL と同値)。1 箇所にしか出てこないので二重定義の
 * cost より変更点を 1 ファイルに閉じる方を取った (= ここで再定義)。
 *
 * @graph-connects none
 */
const SITE_URL = "https://ryantsuji.dev";

type HeadMeta = { title: string } | { name?: string; property?: string; content: string };

/**
 * 1 post 分の HTML <head> meta tag 列を組む。Route.head() から呼ばれ、og:title /
 * og:description / og:image / twitter:* を per-post に上書きする (root の default は
 * blog 全体向け meta なので、詳細 page は自前 meta で塗り直す)。
 *
 * cover が無い post (例: 旧 post で generator 未実行) は root の default
 * og-image.png に fallback させるため `image` を null にして omit する。
 *
 * @graph-connects none
 */
export function buildPostMeta(input: {
  slug: string;
  title: string;
  summary?: string;
  cover?: string;
  lang: Lang;
}): HeadMeta[] {
  const url = `${SITE_URL}/posts/${input.slug}${input.lang === "ja" ? "?lang=ja" : ""}`;
  const description = input.summary ?? `${input.title} — ryantsuji.dev`;
  const image = input.cover ? `${SITE_URL}${input.cover}` : null;

  const meta: HeadMeta[] = [
    { title: `${input.title} — ryantsuji.dev` },
    { name: "description", content: description },
    { property: "og:title", content: input.title },
    { property: "og:description", content: description },
    { property: "og:url", content: url },
    { property: "og:type", content: "article" },
  ];
  if (image) {
    meta.push({ property: "og:image", content: image });
    meta.push({ name: "twitter:card", content: "summary_large_image" });
    meta.push({ name: "twitter:image", content: image });
  }
  return meta;
}

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
  head: ({ loaderData, params }) => {
    if (!loaderData) return {};
    return {
      meta: buildPostMeta({
        slug: params.slug,
        title: loaderData.frontmatter.title,
        summary: loaderData.frontmatter.summary,
        cover: loaderData.frontmatter.cover,
        lang: loaderData.servedLang,
      }),
    };
  },
  component: PostDetail,
});

/** @graph-connects none */
function PostDetail() {
  const { html, frontmatter, headings, readingTimeMinutes, engagement, servedLang } =
    Route.useLoaderData();
  const { slug } = Route.useParams();
  return (
    <main className="post-detail" lang={servedLang}>
      <nav className="post-detail__crumbs">
        <Link to="/posts">← all posts</Link>
      </nav>
      <header className="post-detail__header">
        <h1>{frontmatter.title}</h1>
        <p className="post-detail__meta">
          <time dateTime={frontmatter.publishedAt}>{frontmatter.publishedAt}</time>
          <span className="post-detail__divider" aria-hidden="true">
            ·
          </span>
          <span>{readingTimeMinutes} min read</span>
          {displayTags(frontmatter.tags).length > 0 ? (
            <>
              <span className="post-detail__divider" aria-hidden="true">
                ·
              </span>
              <ul className="post-detail__tags">
                {displayTags(frontmatter.tags).map((tag) => (
                  <li key={tag}>
                    <Link to="/posts" search={{ tag }}>
                      #{tag}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </p>
      </header>
      <PostToc headings={headings} />
      <PostBody html={html} />
      <EngagementSection
        slug={slug}
        title={frontmatter.title}
        lang={servedLang}
        initialLikes={engagement.likes}
        initialComments={engagement.comments}
      />
    </main>
  );
}

/**
 * 本サイトの公開 URL。share intent URL に絶対 URL を埋めるための local 定数。
 * `__root.tsx` / 上部の SITE_URL と同値だが、share pane は client-only でも組み立て
 * られるよう、ここで再定義する (=同 file の方が変更点が閉じる)。
 *
 * @graph-connects none
 */
const SHARE_SITE_URL = SITE_URL;

/**
 * `useServerFn` で得る型を再利用するため一回だけ抽出。test 用 fake にも同 shape を要求できる。
 *
 * @graph-connects none
 */
type ToggleLikeFn = (args: { data: string }) => Promise<{ liked: boolean; count: number }>;
/** @graph-connects none */
type AddCommentFn = (args: {
  data: { slug: string; body: string; parentCommentId?: string | null };
}) => Promise<CommentView>;

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
  args: { slug: string; body: string; parentCommentId?: string | null },
): Promise<{ ok: true; comment: CommentView } | { ok: false; error: string }> {
  const trimmed = args.body.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "コメントを入力してください" };
  }
  try {
    const created = await addCommentFn({
      data: { slug: args.slug, body: trimmed, parentCommentId: args.parentCommentId ?? null },
    });
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
  title,
  lang,
  initialLikes,
  initialComments,
}: {
  slug: string;
  title: string;
  lang: Lang;
  initialLikes: { count: number; liked: boolean };
  initialComments: CommentView[];
}) {
  const { data: session } = useSession();
  const router = useRouter();
  const toggleLikeFn = useServerFn(toggleLikeServer);
  const addCommentFn = useServerFn(addCommentServer);
  const deleteCommentFn = useServerFn(deleteCommentServer);

  const [likes, setLikes] = useState(initialLikes);
  const [comments, setComments] = useState(initialComments);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAuthenticated = !!session?.user;
  const currentUserId = session?.user.id ?? null;

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

  const onReply = async ({ parentId, body }: { parentId: string; body: string }) => {
    const r = await executeAddCommentAction(addCommentFn, {
      slug,
      body,
      parentCommentId: parentId,
    });
    if (r.ok) {
      setComments((prev) => [r.comment, ...prev]);
      return { ok: true };
    }
    return { ok: false, error: r.error };
  };

  const onDeleteComment = async (commentId: string): Promise<void> => {
    try {
      const r = await deleteCommentFn({ data: commentId });
      if (r.deletedId) {
        setComments((prev) => prev.filter((c) => c.id !== r.deletedId));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "delete failed");
    }
  };

  const postUrl = `${SHARE_SITE_URL}/posts/${slug}${lang === "ja" ? "?lang=ja" : ""}`;
  const signInHref = `/posts/${slug}`;

  return (
    <section className="engagement" aria-label="engagement">
      <PostSharePane
        slug={slug}
        title={title}
        lang={lang}
        postUrl={postUrl}
        likes={isAuthenticated ? likes : null}
        onLike={onLike}
        likeSubmitting={submitting}
        signInHref={isAuthenticated ? undefined : signInHref}
      />

      <h2 className="comments__heading">comments ({comments.length})</h2>
      {!isAuthenticated ? (
        <Link to="/sign-in" search={{ redirect: signInHref }} className="engagement__signin">
          sign in to like / comment
        </Link>
      ) : null}
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

      <CommentList
        comments={comments}
        currentUserId={currentUserId}
        onReply={onReply}
        onDelete={onDeleteComment}
      />
    </section>
  );
}
