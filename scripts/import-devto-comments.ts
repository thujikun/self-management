/*
 * dev.to のコメントを ryantsuji.dev の comments テーブルに取り込む。
 *
 * 目的: dev.to の英語記事に付いた質の高い議論 (Vinicius / Mike らとの脅威モデル往復等) を、
 * ryantsuji.dev のコメント欄にも「source=devto」として同じ 1:1 構造で載せる。本文は改稿せず、
 * コメント欄という器で dev.to の議論資産を自サイトにも反映する。
 *
 * 方針:
 * - content/posts の `<slug>.en.md` frontmatter から `syndication.devto.id` (article id) を取り、
 *   dev.to API `GET /api/comments?a_id=<id>` で全コメントツリーを取得する (認証不要)。
 * - **フィルタ**: ryantsuji 本人が返信したトップレベルスレッドだけを取り込む。本人が反応していない
 *   コメント (AI 生成の褒めコメント等のノイズ) は落とす。「Ryan が価値を認めた議論」= 自然な選別。
 * - **本人の返信も取り込む** (返信自体がコンテンツ価値を持つため)。
 * - 原文ママ (body_html を軽く sanitize した plain text)。要約はしない。発言者名 + dev.to プロフィール
 *   URL + 原文 deep link を必ず添える (attribution + 導線)。
 * - dev.to は多階層 nest、ryantsuji.dev は 1 階層。トップレベル = parent 無し、それ以外は所属する
 *   トップレベルへの reply にフラット化し、createdAt 順で会話の流れを保つ。
 * - **冪等**: (source, source_comment_id) の unique index で upsert。過去分 backfill も本 script の
 *   全 post 走査で完結する (初回=一括取り込み、以降=差分)。
 *
 * 使い方:
 *   pnpm tsx scripts/import-devto-comments.ts            # 全 post を backfill / 差分同期
 *   pnpm tsx scripts/import-devto-comments.ts <slug>     # 特定 slug のみ
 *   DRY_RUN=1 pnpm tsx scripts/import-devto-comments.ts  # DB 書き込みせず取り込み内容を print
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business dev.to のコメントを ryantsuji.dev の comments テーブルへ取り込む CLI。本人返信スレッドだけを 1 階層にフラット化し source=devto で冪等 upsert。attribution (発言者名 / プロフィール / 原文リンク) を保持
 * @graph-connects content [reads_from] content/posts の <slug>.en.md frontmatter から devto article id を引く
 * @graph-connects db [calls] @self/db の createDb で comments テーブルに upsert
 */

import { existsSync } from "node:fs";

import { sql } from "drizzle-orm";
import { comments, createDb, posts, type Db } from "@self/db";

import {
  fetchArticleUrl,
  fetchDevtoComments,
  flattenOwnerThreads,
  POSTS_DIR,
  readPostDevtoIds,
  type FlatComment,
} from "./lib/devto-threads.js";
import { formatDryRunLine, orderCommentsForUpsert } from "./lib/devto-upsert.js";

/** DB URL: env → direnv 経由。未設定なら明示エラー。 */
const DATABASE_URL = process.env.DATABASE_URL;

const DRY_RUN = process.env.DRY_RUN === "1";

/** posts テーブルに slug row が無ければ最小限で作る (comments の FK 受け皿)。 */
async function ensurePostRow(db: Db, slug: string, title: string): Promise<void> {
  await db
    .insert(posts)
    .values({ slug, title, publishedAt: new Date() })
    .onConflictDoNothing({ target: posts.slug });
}

/**
 * フラット化済みコメントを comments テーブルに冪等 upsert する。
 * 2 パス: 先にトップレベルを入れて id を確定させ、次に reply の parentCommentId を解決する
 * (順序組立ては `scripts/lib/devto-upsert.ts` に分離、test で固定)。
 * `db` が null (= DRY_RUN) の場合は DB に触れず取り込み内容だけ print する。
 *
 * @graph-connects db [calls] comments テーブルへ (source, source_comment_id) 冪等 upsert
 */
async function upsertComments(db: Db | null, slug: string, flats: FlatComment[]): Promise<number> {
  const ordered = orderCommentsForUpsert(flats);
  if (!db) {
    for (const c of ordered) console.log(formatDryRunLine(c));
    return ordered.length;
  }

  // source_comment_id → 挿入後の comments.id を引くための map。
  const idBySource = new Map<string, string>();
  for (const c of ordered) {
    const parentCommentId = c.parentSourceId ? (idBySource.get(c.parentSourceId) ?? null) : null;
    const rows = await db
      .insert(comments)
      .values({
        postSlug: slug,
        authorId: null,
        authorName: c.authorName,
        authorEmail: null,
        body: c.body,
        source: "devto",
        sourceCommentId: c.sourceCommentId,
        sourceUrl: c.sourceUrl,
        authorProfileUrl: c.authorProfileUrl,
        parentCommentId,
        createdAt: c.createdAt,
      })
      .onConflictDoUpdate({
        target: [comments.source, comments.sourceCommentId],
        set: {
          body: c.body,
          authorName: c.authorName,
          authorProfileUrl: c.authorProfileUrl,
          sourceUrl: c.sourceUrl,
          parentCommentId,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: comments.id });
    const insertedId = rows[0]?.id;
    if (insertedId) idBySource.set(c.sourceCommentId, insertedId);
  }
  return ordered.length;
}

async function main(): Promise<void> {
  const filterSlug = process.argv[2] ?? null;

  if (!DATABASE_URL && !DRY_RUN) {
    throw new Error("DATABASE_URL is not set. Source `.envrc` first, or run with DRY_RUN=1.");
  }
  if (!existsSync(POSTS_DIR)) {
    throw new Error(
      `posts dir not found: ${POSTS_DIR}. Run \`git submodule update --init\` to fetch content.`,
    );
  }

  // DRY_RUN は DB に一切触れない (接続文字列が無効/未設定でも取り込み内容を検証できる)。
  const db = DRY_RUN ? null : createDb(DATABASE_URL as string);

  const targets = await readPostDevtoIds(filterSlug);
  console.log(
    `[import] ${String(targets.length)} post(s) with dev.to id${filterSlug ? ` (slug=${filterSlug})` : ""}${DRY_RUN ? " [DRY_RUN]" : ""}`,
  );

  let totalWritten = 0;
  let first = true;
  for (const { slug, devtoId } of targets) {
    // 全記事を舐める backfill で dev.to のレート制限を避けるため記事間に小休止を挟む
    // (429 自体は fetchDevtoJson がバックオフ再試行するが、そもそも当てない方が速い)。
    if (!first) await new Promise((r) => setTimeout(r, 600));
    first = false;
    const [tree, articleUrl] = await Promise.all([
      fetchDevtoComments(devtoId),
      fetchArticleUrl(devtoId),
    ]);
    const flats = flattenOwnerThreads(tree, articleUrl);
    if (flats.length === 0) {
      console.log(`  ${slug} (a_id=${String(devtoId)}): no owner-threads, skip`);
      continue;
    }
    if (db) {
      await ensurePostRow(db, slug, slug);
    }
    const written = await upsertComments(db, slug, flats);
    console.log(`  ${slug} (a_id=${String(devtoId)}): ${String(written)} comment(s) imported`);
    totalWritten += written;
  }
  console.log(`[import] done: ${String(totalWritten)} comment(s) total`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
