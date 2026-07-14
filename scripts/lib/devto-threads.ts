/*
 * dev.to のコメントツリー取得 + 「本人が絡んだスレッドだけ」抽出の共有ロジック。
 *
 * 2 つの consumer が同じ取得・選別ルールを使うために切り出した pure/IO 混在の lib:
 * - `scripts/import-devto-comments.ts`: ryantsuji.dev の Postgres へ 1 階層フラットで冪等 upsert。
 * - `scripts/build-zenn-comment-paste.ts`: Zenn コメント欄へ手貼りする文面 (原文 + 翻訳枠) を生成。
 *
 * 選別ルールはどちらも共通: OWNER 本人 (`OWNER_USERNAME`) が返信を持つトップレベルスレッド
 * だけを対象にし、本人の返信もコンテンツとして残す。本文は原文ママ (body_html の軽い plain 化)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business dev.to コメント取得と本人関与スレッド抽出の共有ロジック。import (DB upsert) と Zenn 手貼り文面生成の 2 経路で同一の取得・選別・attribution ルールを使うために切り出した
 * @graph-connects devto [calls] GET /api/comments?a_id / GET /api/articles/<id> でツリーと記事 url を取得
 */

import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import matter from "gray-matter";

const LIB_DIR = dirname(fileURLToPath(import.meta.url));
/** scripts/lib/ から見た repo root (2 階層上)。 */
export const REPO_ROOT = resolve(LIB_DIR, "..", "..");

/** ryantsuji.dev 本人の dev.to username。この人の返信を含むスレッドだけ取り込む。 */
export const OWNER_USERNAME = "ryantsuji";

/** content submodule の posts ディレクトリ。 */
export const POSTS_DIR = resolve(REPO_ROOT, "apps/ryantsuji-dev/web/content/posts");

/** dev.to API のコメント 1 件 (ネスト children を持つ)。 */
export interface DevtoComment {
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
export interface FlatComment {
  sourceCommentId: string;
  authorName: string;
  authorUsername: string;
  authorProfileUrl: string;
  sourceUrl: string;
  body: string;
  createdAt: Date;
  /** 所属トップレベルの source_comment_id (自身がトップレベルなら null)。 */
  parentSourceId: string | null;
  /** 本人発言か (Zenn 文面で「自分の返信」を区別するため)。 */
  isOwner: boolean;
}

/** 1 スレッド = トップレベル + そこにフラット化した子孫 (createdAt 昇順)。 */
export interface ThreadGroup {
  top: FlatComment;
  /** top を先頭に含む会話全体 (createdAt 昇順)。 */
  timeline: FlatComment[];
}

/**
 * body_html を軽く plain text 化する。dev.to のコメントは markdown を html 化した形なので、
 * タグを剥がして entity を戻し、コードブロックの改行は保つ程度に留める (原文の意図を削らない)。
 *
 * @graph-connects none
 */
export function htmlToText(html: string): string {
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

/** subtree のどこかに OWNER の発言があるか。 */
function subtreeHasOwner(node: DevtoComment): boolean {
  if (node.user.username === OWNER_USERNAME) return true;
  return node.children.some(subtreeHasOwner);
}

/** DevtoComment 1 件を FlatComment に変換する。 */
function toFlat(
  node: DevtoComment,
  parentSourceId: string | null,
  articleUrl: string,
): FlatComment {
  return {
    sourceCommentId: node.id_code,
    authorName: node.user.name,
    authorUsername: node.user.username,
    authorProfileUrl: `https://dev.to/${node.user.username}`,
    sourceUrl: `${articleUrl}/comments/#comment-${node.id_code}`,
    body: htmlToText(node.body_html),
    createdAt: new Date(node.created_at),
    parentSourceId,
    isOwner: node.user.username === OWNER_USERNAME,
  };
}

/**
 * OWNER が絡むトップレベルスレッドだけを抽出し、各スレッドを 1 階層 (top + フラット化した
 * 子孫) にまとめて返す。会話の流れは created_at 昇順で保つ。
 *
 * @graph-connects none
 */
export function groupOwnerThreads(tree: DevtoComment[], articleUrl: string): ThreadGroup[] {
  const groups: ThreadGroup[] = [];
  for (const top of tree) {
    if (!subtreeHasOwner(top)) continue; // OWNER が絡まないスレッドは丸ごと落とす
    const topFlat = toFlat(top, null, articleUrl);
    const timeline: FlatComment[] = [topFlat];
    const walk = (node: DevtoComment): void => {
      for (const child of node.children) {
        timeline.push(toFlat(child, top.id_code, articleUrl));
        walk(child);
      }
    };
    walk(top);
    timeline.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    groups.push({ top: topFlat, timeline });
  }
  return groups;
}

/**
 * OWNER が絡むスレッドを 1 階層フラットな配列に畳む (DB upsert 用)。
 * `groupOwnerThreads` の timeline を連結しただけ。
 *
 * @graph-connects none
 */
export function flattenOwnerThreads(tree: DevtoComment[], articleUrl: string): FlatComment[] {
  return groupOwnerThreads(tree, articleUrl).flatMap((g) => g.timeline);
}

/**
 * dev.to API で記事のコメントツリーを取得する。認証不要 (public 記事)。
 *
 * @graph-connects devto [calls] GET /api/comments?a_id=<id> でコメントツリーを取得
 */
export async function fetchDevtoComments(articleId: number): Promise<DevtoComment[]> {
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

/** 記事の deep link 構築 / 見出し表示に使う最小メタ。 */
export interface ArticleMeta {
  url: string;
  title: string;
}

/**
 * dev.to API で記事の canonical url + title を取得する (deep link / 見出し用)。
 *
 * @graph-connects devto [calls] GET /api/articles/<id> で記事 url / title を取得
 */
export async function fetchArticleMeta(articleId: number): Promise<ArticleMeta> {
  const res = await fetch(`https://dev.to/api/articles/${String(articleId)}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(
      `dev.to article fetch failed: ${String(res.status)} for id=${String(articleId)}`,
    );
  }
  const data = (await res.json()) as { url?: string; title?: string };
  if (!data.url) throw new Error(`dev.to article ${String(articleId)} has no url`);
  return { url: data.url, title: data.title ?? `article ${String(articleId)}` };
}

/**
 * 記事の canonical url だけを取得する薄いラッパー (import 経路の後方互換)。
 *
 * @graph-connects none
 */
export async function fetchArticleUrl(articleId: number): Promise<string> {
  return (await fetchArticleMeta(articleId)).url;
}

/** content/posts の全 <slug>.en.md から slug ↔ devto article id を引く。 */
export async function readPostDevtoIds(
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
