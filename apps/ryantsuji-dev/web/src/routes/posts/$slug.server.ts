/**
 * `/posts/$slug` の **server-only** ロジック (DB / 認証 / TanStack Start request 取得)。
 *
 * `@tanstack/react-start/server` の `getRequestHeaders` は client bundle に乗ると
 * vite の import-protection plugin に弾かれるため、`.server.ts` に隔離する。route
 * 本体 (`$slug.tsx`) はここから export された `run*` 関数を `createServerFn().handler`
 * に渡すだけで済み、client bundle にはこのファイルが入らない。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business /posts/$slug の server fn 本体を切出したファイル。@tanstack/react-start/server の getRequestHeaders を含む server-only import を集約し、route 本体 ($slug.tsx) を client bundle 安全に保つ
 * @graph-connects content [calls] loadPostEngagement / toggleLike / addComment
 * @graph-connects better-auth [calls] getSessionFromHeaders で current user を解決
 * @graph-connects tanstack-start [calls] getRequestHeaders で request header を読む
 */

import { getRequestHeaders } from "@tanstack/react-start/server";

import { readEnvFromProcess } from "../../server/auth.js";
import { getSessionFromHeaders } from "../../server/auth-session.js";
import { createDbFromProcess } from "../../server/db.js";
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
export async function runLoadEngagement(slug: string): Promise<{
  viewCount: string;
  likes: { count: number; liked: boolean };
  comments: CommentView[];
}> {
  const db = createDbFromProcess();
  const session = await getSessionFromHeaders(
    new Headers(getRequestHeaders()),
    readEnvFromProcess(),
  );
  const userId = session?.user.id ?? null;
  return await loadPostEngagement(db, { slug, identifier: userId, bumpView: true });
}

/**
 * toggleLikeServer の handler 本体。未認証なら UNAUTHENTICATED を throw する auth gate 込み。
 *
 * @graph-connects content [calls] toggleLike (auth 必須)
 */
export async function runToggleLike(slug: string): Promise<{ liked: boolean; count: number }> {
  const session = await getSessionFromHeaders(
    new Headers(getRequestHeaders()),
    readEnvFromProcess(),
  );
  if (!session) throw new Error("UNAUTHENTICATED");
  const db = createDbFromProcess();
  return await toggleLike(db, slug, session.user.id);
}

/**
 * addCommentServer の handler 本体。auth gate + body 受け渡し。
 *
 * @graph-connects content [calls] addComment (auth 必須)
 */
export async function runAddComment(args: { slug: string; body: string }): Promise<CommentView> {
  const session = await getSessionFromHeaders(
    new Headers(getRequestHeaders()),
    readEnvFromProcess(),
  );
  if (!session) throw new Error("UNAUTHENTICATED");
  const db = createDbFromProcess();
  return await addComment(db, {
    slug: args.slug,
    authorId: session.user.id,
    authorName: session.user.name,
    authorEmail: session.user.email,
    body: args.body,
  });
}
