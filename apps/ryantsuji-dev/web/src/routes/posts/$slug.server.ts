/**
 * `/posts/$slug` の **server-only** ロジック (DB / 認証 / TanStack Start request 取得)。
 *
 * `@tanstack/react-start/server` の `getRequestHeaders` は client bundle に乗ると vite の
 * import-protection plugin に弾かれるため、`.server.ts` に隔離する。route 本体 (`$slug.tsx`)
 * はここから export された `run*` 関数を `createServerFn().handler` に渡すだけで済み、
 * client bundle にはこのファイルが入らない。
 *
 * env binding は **引数で受ける** (`context.env` を route 側で取り出して flow)。`process.env`
 * 経路は廃止 (CF Workers 適応のため。`src/server.ts` が requestContext に詰めて、各 server fn
 * の handler.context.env として届く)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business /posts/$slug の server fn 本体を切出したファイル。@tanstack/react-start/server の getRequestHeaders を含む server-only import を集約し、route 本体 ($slug.tsx) を client bundle 安全に保つ。env は context.env (CF Workers binding) を引数で受け取る形に統一
 * @graph-connects content [calls] loadPostEngagement / toggleLike / addComment
 * @graph-connects better-auth [calls] getSessionFromHeaders で current user を解決
 * @graph-connects tanstack-start [calls] getRequestHeaders で request header を読む
 */

import { getRequestHeaders } from "@tanstack/react-start/server";
import type { RenderedDoc } from "@self/content";
import { notFound } from "@tanstack/react-router";

import type { Env } from "../../start.js";
import { getSessionFromHeaders } from "../../server/auth-session.js";
import { createDbFromEnv } from "../../server/db.js";
import {
  addComment,
  deleteComment,
  loadPostEngagement,
  toggleLike,
  type CommentView,
} from "../../server/engagement.js";
import { pickLang, type Lang } from "../../server/i18n.js";
import { getRenderedPost } from "../../server/posts.js";
import { getSeriesNav } from "../../server/series.js";
import {
  safeAcceptLanguage,
  safeCookieLang,
  writeLangCookie,
} from "../../server/request.server.js";

/**
 * renderPostServer の handler 本体。`?lang=` override + Accept-Language + cookie で
 * lang を確定 → `getRenderedPost(slug, lang)` で **build 時に pre-render 済の**
 * RenderedDoc を lookup (無ければ en fallback) → そのまま返す。
 *
 * 旧設計は runtime で `renderMarkdown` を回していたが、長い記事で Worker CPU 上限
 * (Free plan 10ms) を超え Error 1102 が発生していた。新設計は build 時に shiki /
 * unified を一括で回しておくので、runtime は lookup のみで CPU 消費ほぼゼロ。
 *
 * @graph-connects content [calls] getRenderedPost で pre-rendered HTML を取得
 */
export async function runRenderPost(
  slug: string,
  override: Lang | undefined,
  options: { includeDrafts?: boolean } = {},
): Promise<
  Pick<RenderedDoc, "html" | "frontmatter" | "headings" | "readingTimeMinutes"> & {
    servedLang: Lang;
    availableLangs: Lang[];
    seriesNav: SerializedSeriesNav | null;
  }
> {
  const cookieLang = safeCookieLang();
  const lang = pickLang({
    override,
    cookieLang,
    acceptLanguage: safeAcceptLanguage(),
  });
  if (override && override !== cookieLang) {
    writeLangCookie(lang);
  }
  const result = getRenderedPost(slug, lang, { includeDrafts: options.includeDrafts ?? false });
  if (!result) throw notFound();
  const nav = getSeriesNav(slug, result.servedLang, {
    includeDrafts: options.includeDrafts ?? false,
  });
  return {
    html: result.rendered.html,
    frontmatter: result.rendered.frontmatter,
    headings: result.rendered.headings,
    readingTimeMinutes: result.rendered.readingTimeMinutes,
    servedLang: result.servedLang,
    availableLangs: result.availableLangs,
    seriesNav: nav ? serializeSeriesNav(nav) : null,
  };
}

/**
 * route loader data として client に流す series nav の serializable shape。post
 * 全 frontmatter を載せると無駄に重いので、表示に必要な (title / slug / order) だけ
 * pick して slim down する。
 *
 * @graph-connects none
 */
export interface SerializedSeriesNav {
  meta: { slug: string; title: string };
  total: number;
  currentOrder: number;
  prev: { slug: string; title: string } | null;
  next: { slug: string; title: string } | null;
}

/** @graph-connects none */
export function serializeSeriesNav(
  nav: NonNullable<ReturnType<typeof getSeriesNav>>,
): SerializedSeriesNav {
  const currentOrder = nav.posts[nav.currentIndex]?.seriesOrder ?? nav.currentIndex + 1;
  return {
    meta: { slug: nav.meta.slug, title: nav.meta.title },
    total: nav.posts.length,
    currentOrder,
    prev: nav.prev ? { slug: nav.prev.slug, title: nav.prev.title } : null,
    next: nav.next ? { slug: nav.next.slug, title: nav.next.title } : null,
  };
}

/**
 * loadEngagementServer の handler 本体。test で直接呼べる pure 化された shape。
 *
 * admin (`session.user.email === env.ADMIN_EMAIL`) からの request では `bumpView: false`
 * にして公開前の draft preview で view count が伸びるのを防ぐ。`ensurePost` は引続き
 * 呼ばれるが、posts 行は公開時に title / publishedAt が再 upsert される shape なので
 * preview 由来の row が残っても公開時の表示には影響しない (view_counts のみ admin が
 * 触れない方向に倒す)。
 *
 * @graph-connects content [calls] loadPostEngagement (view bump + likes + comments)
 */
export async function runLoadEngagement(
  env: Env,
  args: { slug: string; post: { title: string; publishedAt: string } },
): Promise<{
  viewCount: string;
  likes: { count: number; liked: boolean };
  comments: CommentView[];
}> {
  const db = createDbFromEnv(env);
  const session = await getSessionFromHeaders(new Headers(getRequestHeaders()), env);
  const userId = session?.user.id ?? null;
  const isAdmin = !!env.ADMIN_EMAIL && session?.user.email === env.ADMIN_EMAIL;
  return await loadPostEngagement(db, {
    slug: args.slug,
    identifier: userId,
    bumpView: !isAdmin,
    post: args.post,
  });
}

/**
 * toggleLikeServer の handler 本体。未認証なら UNAUTHENTICATED を throw する auth gate 込み。
 *
 * @graph-connects content [calls] toggleLike (auth 必須)
 */
export async function runToggleLike(
  env: Env,
  slug: string,
): Promise<{ liked: boolean; count: number }> {
  const session = await getSessionFromHeaders(new Headers(getRequestHeaders()), env);
  if (!session) throw new Error("UNAUTHENTICATED");
  const db = createDbFromEnv(env);
  return await toggleLike(db, slug, session.user.id);
}

/**
 * addCommentServer の handler 本体。auth gate + body + 任意の parentCommentId 受け渡し。
 *
 * @graph-connects content [calls] addComment (auth 必須)
 */
export async function runAddComment(
  env: Env,
  args: { slug: string; body: string; parentCommentId?: string | null },
): Promise<CommentView> {
  const session = await getSessionFromHeaders(new Headers(getRequestHeaders()), env);
  if (!session) throw new Error("UNAUTHENTICATED");
  const db = createDbFromEnv(env);
  return await addComment(db, {
    slug: args.slug,
    authorId: session.user.id,
    authorName: session.user.name,
    authorEmail: session.user.email,
    body: args.body,
    parentCommentId: args.parentCommentId ?? null,
  });
}

/**
 * deleteCommentServer の handler 本体。auth gate + 自分の comment のみ soft delete。
 * 戻り値の `deletedId` が null なら「対象なし or 権限なし」(UI は invalidate して再取得)。
 *
 * @graph-connects content [calls] deleteComment (auth 必須、author check は SQL where 句で)
 */
export async function runDeleteComment(
  env: Env,
  commentId: string,
): Promise<{ deletedId: string | null }> {
  const session = await getSessionFromHeaders(new Headers(getRequestHeaders()), env);
  if (!session) throw new Error("UNAUTHENTICATED");
  const db = createDbFromEnv(env);
  return await deleteComment(db, { commentId, requesterId: session.user.id });
}
