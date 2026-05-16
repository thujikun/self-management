/**
 * post engagement (view counts / likes / comments) の DB 層を集約した server-only module。
 *
 * 全関数は `db` (Drizzle/Neon HTTP) と引数だけを取る pure な shape。createServerFn handler
 * 側で env から db を作って渡す形 (mock 容易、createServerFn の境界に env 読みを 1 か所
 * 集約)。
 *
 * 設計判断:
 * - **認証必須**: `toggleLike` / `addComment` は authenticated user のみ。schema は anonymous
 *   identifier も支えるが、個人サイト方針 (allowlist) と整合させて UI 経路は user.id 一本
 * - **view count は anonymous 込みの全 view 加算**: schema コメント通り、UPSERT で atomic +1
 * - **comments は plain text** で保存 (markdown render は次 iter)
 * - **soft delete 対応**: comments の `deletedAt IS NULL` のみ list に出す
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 投稿エンゲージメント (view / like / comment) の DB 層。createServerFn 経由で route から呼ばれ、Drizzle/Neon HTTP で Postgres を叩く。auth 必須 (likes/comments) と auth 不要 (views) を分離、UPSERT で view を atomic に increment、likes は (slug, userId) で toggle、comments は soft delete を考慮した list 経路
 * @graph-connects content [embeds] @self/db の posts/comments/likes/viewCounts schema を直接 query
 */

import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { comments, likes, posts, viewCounts, type Db } from "@self/db";

import { normalizeTimestamp, validateCommentBody } from "./engagement-validate.js";

/**
 * `posts` row が無ければ insert、有れば title / publishedAt を最新化する upsert。
 *
 * markdown SSoT の post に対する `comments` / `likes` / `view_counts` の FK 受け皿
 * (posts.slug primary key) が DB 側に常に存在することを保証するため、engagement の
 * 各 mutation の前段で呼ぶ。failure 時 (例: title が一時的に空など) も最小限の row
 * は作るので、view counter / like の動線が壊れない。
 *
 * @graph-connects content [calls] posts に UPSERT (slug primary key)
 */
export async function ensurePost(
  db: Db,
  args: { slug: string; title: string; publishedAt: string },
): Promise<void> {
  await db
    .insert(posts)
    .values({
      slug: args.slug,
      title: args.title,
      publishedAt: new Date(args.publishedAt),
    })
    .onConflictDoUpdate({
      target: posts.slug,
      set: {
        title: args.title,
        publishedAt: new Date(args.publishedAt),
        updatedAt: sql`now()`,
      },
    });
}

/**
 * View count を atomic に +1 する。row が無ければ 1 で create、有れば count = count + 1。
 * 戻り値は increment 後の最新値。
 *
 * @graph-connects content [calls] view_counts に UPSERT で +1
 */
export async function bumpViewCount(db: Db, slug: string): Promise<bigint> {
  const rows = await db
    .insert(viewCounts)
    .values({ postSlug: slug, count: 1n })
    .onConflictDoUpdate({
      target: viewCounts.postSlug,
      set: {
        count: sql`${viewCounts.count} + 1`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ count: viewCounts.count });
  if (rows.length === 0) {
    // RETURNING が空になる経路は理論上無いが、Neon HTTP 失敗時の防御として明示。
    throw new Error(`bumpViewCount: no row returned for slug=${slug}`);
  }
  return rows[0].count;
}

/**
 * View count を取得 (increment しない)。row 不在は 0 を返す。SSR loader / API GET 用。
 *
 * @graph-connects content [calls] view_counts SELECT
 */
export async function getViewCount(db: Db, slug: string): Promise<bigint> {
  const rows = await db
    .select({ count: viewCounts.count })
    .from(viewCounts)
    .where(eq(viewCounts.postSlug, slug))
    .limit(1);
  return rows[0]?.count ?? 0n;
}

/**
 * 指定 post の like 集計。`liked` は呼び出し元 user (`identifier`) が like 済かどうか。
 * `identifier` が null (未認証) なら liked: false 固定。
 *
 * 現状 kind は "like" 固定で運用、reaction kind を増やしたら別 API を生やす方針。
 *
 * @graph-connects content [calls] likes COUNT + EXISTS
 */
export async function getLikeSummary(
  db: Db,
  slug: string,
  identifier: string | null,
): Promise<{ count: number; liked: boolean }> {
  const countRows = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(likes)
    .where(and(eq(likes.postSlug, slug), eq(likes.kind, "like")));
  const count = countRows[0]?.c ?? 0;
  if (!identifier) return { count, liked: false };
  const mineRows = await db
    .select({ identifier: likes.identifier })
    .from(likes)
    .where(and(eq(likes.postSlug, slug), eq(likes.kind, "like"), eq(likes.identifier, identifier)))
    .limit(1);
  return { count, liked: mineRows.length > 0 };
}

/**
 * (slug, identifier, "like") の有無を toggle する。
 * 戻り値は toggle **後** の `{ liked, count }`。
 *
 * 認証必須経路 (caller が identifier = userId を保証する想定)。
 *
 * @graph-connects content [calls] likes INSERT / DELETE + COUNT
 */
export async function toggleLike(
  db: Db,
  slug: string,
  identifier: string,
): Promise<{ liked: boolean; count: number }> {
  const existing = await db
    .select({ identifier: likes.identifier })
    .from(likes)
    .where(and(eq(likes.postSlug, slug), eq(likes.kind, "like"), eq(likes.identifier, identifier)))
    .limit(1);
  if (existing.length > 0) {
    await db
      .delete(likes)
      .where(
        and(eq(likes.postSlug, slug), eq(likes.kind, "like"), eq(likes.identifier, identifier)),
      );
    const summary = await getLikeSummary(db, slug, identifier);
    return summary;
  }
  await db.insert(likes).values({ postSlug: slug, identifier, kind: "like" });
  const summary = await getLikeSummary(db, slug, identifier);
  return summary;
}

/**
 * UI に出す用の comment shape (DB row から `deletedAt` などを落とした表示寄り型)。
 *
 * @graph-connects none
 */
export interface CommentView {
  id: string;
  authorName: string;
  authorId: string | null;
  body: string;
  createdAt: string;
  /** 親 comment id (null = top-level、UUID = その親への reply、1 階層のみ) */
  parentCommentId: string | null;
}

/**
 * `deletedAt IS NULL` の comment を新着順で返す。soft delete は list 経路から落とす。
 * thread 用に親子フラットで返し、UI 側で `parentCommentId` で nest する。
 *
 * @graph-connects content [calls] comments SELECT (deletedAt IS NULL)
 */
export async function listComments(db: Db, slug: string): Promise<CommentView[]> {
  const rows = await db
    .select({
      id: comments.id,
      authorName: comments.authorName,
      authorId: comments.authorId,
      body: comments.body,
      createdAt: comments.createdAt,
      parentCommentId: comments.parentCommentId,
    })
    .from(comments)
    .where(and(eq(comments.postSlug, slug), isNull(comments.deletedAt)))
    .orderBy(desc(comments.createdAt));
  return rows.map((r) => ({
    id: r.id,
    authorName: r.authorName,
    authorId: r.authorId,
    body: r.body,
    createdAt: normalizeTimestamp(r.createdAt),
    parentCommentId: r.parentCommentId,
  }));
}

/**
 * 認証 user 限定の comment 投稿。caller が user の identity を保証する想定。
 * 空 / 空白のみ body は reject (UI 側でも check するが server 側でも double-check)。
 *
 * `parentCommentId` を指定すると reply として登録される (1 階層のみ — UI 側で
 * thread に折り畳む)。親が同じ post slug に属することは DB 側で FK + slug filter
 * で担保される (本関数では post slug の追加 check はしない)。
 *
 * @graph-connects content [calls] comments INSERT
 */
export async function addComment(
  db: Db,
  args: {
    slug: string;
    authorId: string;
    authorName: string;
    authorEmail: string;
    body: string;
    parentCommentId?: string | null;
  },
): Promise<CommentView> {
  const body = validateCommentBody(args.body);
  const rows = await db
    .insert(comments)
    .values({
      postSlug: args.slug,
      authorId: args.authorId,
      authorName: args.authorName,
      authorEmail: args.authorEmail,
      body,
      parentCommentId: args.parentCommentId ?? null,
    })
    .returning({
      id: comments.id,
      authorName: comments.authorName,
      authorId: comments.authorId,
      body: comments.body,
      createdAt: comments.createdAt,
      parentCommentId: comments.parentCommentId,
    });
  if (rows.length === 0) {
    throw new Error("addComment: no row returned");
  }
  const r = rows[0];
  return {
    id: r.id,
    authorName: r.authorName,
    authorId: r.authorId,
    body: r.body,
    createdAt: normalizeTimestamp(r.createdAt),
    parentCommentId: r.parentCommentId,
  };
}

/**
 * 認証 user が自分の comment を soft delete する。`deletedAt = now()` で row は残し、
 * `listComments` で除外される。authorId 不一致なら no-op (上位は 404 boundary に倒す
 * のではなく、後続 SELECT で消えてない事実から「権限なし」を察する設計)。
 *
 * 戻り値は実際に削除した comment id (見つからず / 権限なしなら null)。
 *
 * @graph-connects content [calls] comments UPDATE (deletedAt = now)
 */
export async function deleteComment(
  db: Db,
  args: { commentId: string; requesterId: string },
): Promise<{ deletedId: string | null }> {
  const rows = await db
    .update(comments)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(comments.id, args.commentId),
        eq(comments.authorId, args.requesterId),
        isNull(comments.deletedAt),
      ),
    )
    .returning({ id: comments.id });
  return { deletedId: rows[0]?.id ?? null };
}

/**
 * SSR loader 用の合成 fetcher。1 view bump + view count + likes summary + comments list を
 * 1 まとめにして返す。route 側の boilerplate を減らす。
 *
 * `bumpView=true` で SSR 初回 render 時に view を +1 (再 render では呼ばれないので spam 安全)。
 * `identifier=null` (未認証) でも likes summary は count のみ取れるので動く。
 *
 * @graph-connects content [calls] bumpViewCount + getLikeSummary + listComments を直列
 */
export async function loadPostEngagement(
  db: Db,
  args: {
    slug: string;
    identifier: string | null;
    bumpView: boolean;
    post: { title: string; publishedAt: string };
  },
): Promise<{
  viewCount: string;
  likes: { count: number; liked: boolean };
  comments: CommentView[];
}> {
  // posts 行を毎回 upsert で確保。markdown SSoT の content 変更を DB にも反映、
  // FK target が無くて comments / likes / view_counts が落ちるのを防ぐ。
  await ensurePost(db, {
    slug: args.slug,
    title: args.post.title,
    publishedAt: args.post.publishedAt,
  });
  const view = args.bumpView
    ? await bumpViewCount(db, args.slug)
    : await getViewCount(db, args.slug);
  const likeSummary = await getLikeSummary(db, args.slug, args.identifier);
  const list = await listComments(db, args.slug);
  return {
    viewCount: view.toString(),
    likes: likeSummary,
    comments: list,
  };
}
