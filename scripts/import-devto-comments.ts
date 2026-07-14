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
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import matter from "gray-matter";
import { sql } from "drizzle-orm";
import { comments, createDb, posts, type Db } from "@self/db";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPTS_DIR, "..");

/** ryantsuji.dev 本人の dev.to username。この人の返信を含むスレッドだけ取り込む。 */
const OWNER_USERNAME = "ryantsuji";

/** content submodule の posts ディレクトリ。 */
const POSTS_DIR = resolve(REPO_ROOT, "apps/ryantsuji-dev/web/content/posts");

/** DB URL: env → direnv 経由。未設定なら明示エラー。 */
const DATABASE_URL = process.env.DATABASE_URL;

const DRY_RUN = process.env.DRY_RUN === "1";

/** dev.to API のコメント 1 件 (ネスト children を持つ)。 */
interface DevtoComment {
  type_of: string;
  id_code: string;
  created_at: string;
  body_html: string;
  user: {
    name: string;
    username: string;
  };
  children: DevtoComment[];
}

/** フラット化後の取り込み対象 1 件。 */
interface FlatComment {
  sourceCommentId: string;
  authorName: string;
  authorProfileUrl: string;
  sourceUrl: string;
  body: string;
  createdAt: Date;
  /** 所属トップレベルの source_comment_id (自身がトップレベルなら null)。 */
  parentSourceId: string | null;
}

/**
 * body_html を軽く plain text 化する。dev.to のコメントは markdown を html 化した形なので、
 * タグを剥がして entity を戻し、コードブロックの改行は保つ程度に留める (原文の意図を削らない)。
 *
 * @graph-connects none
 */
function htmlToText(html: string): string {
  return html
    .replace(/<\/(p|div|li|h[1-6]|blockquote|pre)>/g, "\n\n")
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * dev.to のコメントツリーから、OWNER が返信を持つトップレベルスレッドだけを 1 階層に
 * フラット化する。会話の流れは created_at 昇順で保つ。
 *
 * @graph-connects none
 */
function flattenOwnerThreads(tree: DevtoComment[], articleUrl: string): FlatComment[] {
  const out: FlatComment[] = [];

  const subtreeHasOwner = (node: DevtoComment): boolean => {
    if (node.user.username === OWNER_USERNAME) return true;
    return node.children.some(subtreeHasOwner);
  };

  const toFlat = (node: DevtoComment, parentSourceId: string | null): FlatComment => ({
    sourceCommentId: node.id_code,
    authorName: node.user.name,
    authorProfileUrl: `https://dev.to/${node.user.username}`,
    sourceUrl: `${articleUrl}/comments/#comment-${node.id_code}`,
    body: htmlToText(node.body_html),
    createdAt: new Date(node.created_at),
    parentSourceId,
  });

  for (const top of tree) {
    if (!subtreeHasOwner(top)) continue; // OWNER が絡まないスレッドは丸ごと落とす
    // トップレベルは parent 無し。子孫は全部このトップレベルへの reply に畳む (1 階層化)。
    const collected: FlatComment[] = [toFlat(top, null)];
    const walk = (node: DevtoComment): void => {
      for (const child of node.children) {
        collected.push(toFlat(child, top.id_code));
        walk(child);
      }
    };
    walk(top);
    collected.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    out.push(...collected);
  }
  return out;
}

/**
 * dev.to API で記事のコメントツリーを取得する。認証不要 (public 記事)。
 *
 * @graph-connects devto [calls] GET /api/comments?a_id=<id> でコメントツリーを取得
 */
async function fetchDevtoComments(articleId: number): Promise<DevtoComment[]> {
  const res = await fetch(`https://dev.to/api/comments?a_id=${String(articleId)}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(
      `dev.to comments fetch failed: ${String(res.status)} for a_id=${String(articleId)}`,
    );
  }
  return (await res.json()) as DevtoComment[];
}

/**
 * dev.to API で記事の canonical path を取得する (deep link 構築用)。
 *
 * @graph-connects devto [calls] GET /api/articles/<id> で記事 url を取得
 */
async function fetchArticleUrl(articleId: number): Promise<string> {
  const res = await fetch(`https://dev.to/api/articles/${String(articleId)}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(
      `dev.to article fetch failed: ${String(res.status)} for id=${String(articleId)}`,
    );
  }
  const data = (await res.json()) as { url?: string };
  if (!data.url) throw new Error(`dev.to article ${String(articleId)} has no url`);
  return data.url;
}

/** content/posts の全 <slug>.en.md から slug ↔ devto article id を引く。 */
async function readPostDevtoIds(
  filterSlug: string | null,
): Promise<{ slug: string; devtoId: number }[]> {
  const files = await readdir(POSTS_DIR);
  const out: { slug: string; devtoId: number }[] = [];
  for (const f of files) {
    if (!f.endsWith(".en.md")) continue;
    if (f.startsWith("_")) continue; // fixture
    const slug = f.slice(0, -".en.md".length);
    if (filterSlug && slug !== filterSlug) continue;
    const raw = await readFile(resolve(POSTS_DIR, f), "utf8");
    const fm = matter(raw).data as {
      syndication?: { devto?: { id?: number } };
    };
    const devtoId = fm.syndication?.devto?.id;
    if (typeof devtoId === "number") out.push({ slug, devtoId });
  }
  return out;
}

/** posts テーブルに slug row が無ければ最小限で作る (comments の FK 受け皿)。 */
async function ensurePostRow(db: Db, slug: string, title: string): Promise<void> {
  await db
    .insert(posts)
    .values({ slug, title, publishedAt: new Date() })
    .onConflictDoNothing({ target: posts.slug });
}

/**
 * フラット化済みコメントを comments テーブルに冪等 upsert する。
 * 2 パス: 先にトップレベルを入れて id を確定させ、次に reply の parentCommentId を解決する。
 *
 * @graph-connects db [calls] comments テーブルへ (source, source_comment_id) 冪等 upsert
 */
async function upsertComments(db: Db, slug: string, flats: FlatComment[]): Promise<number> {
  // source_comment_id → 挿入後の comments.id を引くための map。
  const idBySource = new Map<string, string>();

  // まずトップレベル (parent 無し) を先に処理して id を確定。
  const ordered = [
    ...flats.filter((c) => c.parentSourceId === null),
    ...flats.filter((c) => c.parentSourceId !== null),
  ];

  let written = 0;
  for (const c of ordered) {
    const parentCommentId = c.parentSourceId ? (idBySource.get(c.parentSourceId) ?? null) : null;
    if (DRY_RUN) {
      console.log(
        `    [dry] ${c.parentSourceId ? "  ↳" : "•"} ${c.authorName} (${c.sourceCommentId}): ${c.body.slice(0, 60).replace(/\n/g, " ")}…`,
      );
      // dry-run でも parent 解決の整合を確認できるよう仮 id を振る
      idBySource.set(c.sourceCommentId, `dry-${c.sourceCommentId}`);
      written += 1;
      continue;
    }
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
    written += 1;
  }
  return written;
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
  for (const { slug, devtoId } of targets) {
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
    const written = db
      ? await upsertComments(db, slug, flats)
      : await upsertComments(null as unknown as Db, slug, flats);
    console.log(`  ${slug} (a_id=${String(devtoId)}): ${String(written)} comment(s) imported`);
    totalWritten += written;
  }
  console.log(`[import] done: ${String(totalWritten)} comment(s) total`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
