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

import type { Env } from "../../start.js";
import { getSessionFromHeaders } from "../../server/auth-session.js";
import { createDbFromEnv } from "../../server/db.js";
import {
  addComment,
  loadPostEngagement,
  toggleLike,
  type CommentView,
} from "../../server/engagement.js";

/**
 * loadEngagementServer の handler 本体。test で直接呼べる pure 化された shape。
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
  return await loadPostEngagement(db, {
    slug: args.slug,
    identifier: userId,
    bumpView: true,
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
 * addCommentServer の handler 本体。auth gate + body 受け渡し。
 *
 * @graph-connects content [calls] addComment (auth 必須)
 */
export async function runAddComment(
  env: Env,
  args: { slug: string; body: string },
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
  });
}
