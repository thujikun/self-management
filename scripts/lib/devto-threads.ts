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
import { z } from "zod";

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

/** 投稿者がアカウント / コメントを削除した場合に dev.to が返す欠落 user の代替名。 */
const DELETED_USER_NAME = "[deleted]";

/**
 * dev.to API レスポンスの境界検証 schema (`DevtoComment` の再帰形)。
 * 外部 API の shape 変化を DB 書き込みや深部の walk まで素通しにせず、fetch 直後に弾く。
 *
 * `user.name` / `user.username` は **欠落を許容する**。投稿者がアカウントやコメントを削除すると
 * dev.to は user フィールドを欠いた (null/undefined) コメントを返すため、ここを必須にすると
 * 削除コメントを 1 件でも含む記事の取り込みが丸ごと落ちる。欠落時は placeholder に正規化し、
 * username 空 = 非 OWNER 扱い (プロフィール URL も後段で抑止) にする。
 */
const devtoCommentSchema: z.ZodType<DevtoComment> = z.lazy(() =>
  z.object({
    type_of: z.string(),
    id_code: z.string(),
    created_at: z.string(),
    body_html: z.string(),
    user: z
      .object({ name: z.string().nullish(), username: z.string().nullish() })
      .transform((u) => ({ name: u.name ?? DELETED_USER_NAME, username: u.username ?? "" })),
    children: z.array(devtoCommentSchema),
  }),
);

/**
 * unknown な API レスポンスを DevtoComment[] として検証する。shape 不一致は
 * どのフィールドが不正かを示す ZodError で落ちる (深部のクラッシュより原因が追える)。
 *
 * @graph-connects none
 */
export function parseDevtoComments(data: unknown): DevtoComment[] {
  return z.array(devtoCommentSchema).parse(data);
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
  return (
    html
      .replace(/<\/(p|div|li|h[1-6]|blockquote|pre)>/g, "\n\n")
      .replace(/<br\s*\/?>/g, "\n")
      // リンクは URL ごと markdown 形式で保持する (原文の参照 URL を落とさない)。
      // text と href が同一の bare link は URL 単体に畳む。
      .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, (_m, href: string, text: string) =>
        text.trim() === href ? href : `[${text.trim()}](${href})`,
      )
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/** subtree のどこかに OWNER の発言があるか。 */
function subtreeHasOwner(node: DevtoComment): boolean {
  if (node.user.username === OWNER_USERNAME) return true;
  return node.children.some(subtreeHasOwner);
}

/**
 * subtree のどこかに削除コメント (投稿者が削除して username 欠落 = 空文字) があるか。
 * 削除が 1 件でも混じるスレッドは文脈が欠けるため丸ごと取り込み対象外にする。
 */
function subtreeHasDeleted(node: DevtoComment): boolean {
  if (node.user.username === "") return true;
  return node.children.some(subtreeHasDeleted);
}

/** DevtoComment 1 件を FlatComment に変換する。 */
function toFlat(
  node: DevtoComment,
  parentSourceId: string | null,
  articleUrl: string,
): FlatComment {
  const username = node.user.username;
  return {
    sourceCommentId: node.id_code,
    authorName: node.user.name,
    authorUsername: username,
    // 削除ユーザー (username 空) はプロフィール URL を持たない (壊れた dev.to/ リンクを出さない)。
    authorProfileUrl: username ? `https://dev.to/${username}` : "",
    sourceUrl: `${articleUrl}/comments/#comment-${node.id_code}`,
    body: htmlToText(node.body_html),
    createdAt: new Date(node.created_at),
    parentSourceId,
    isOwner: username === OWNER_USERNAME,
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
    if (subtreeHasDeleted(top)) continue; // 削除コメント混じりは文脈が欠けるので丸ごと落とす
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

/** 一時障害リトライの挙動。テストのために sleep / fetch を注入できる。 */
export interface FetchRetryOptions {
  /** 追加試行回数 (初回を除く)。 */
  retries?: number;
  /** 指数バックオフの基準ミリ秒 (attempt 0 の待機)。 */
  baseDelayMs?: number;
  /** 待機実装 (テストで即時解決に差し替える)。 */
  sleep?: (ms: number) => Promise<void>;
  /** fetch 実装 (テストで stub に差し替える)。 */
  fetchImpl?: typeof fetch;
  /** Retry-After / backoff 計算の現在時刻 (テスト決定性のため注入可)。 */
  now?: () => number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * リトライ 1 回あたりの待機上限 ms。`Retry-After` が極端な値 (3600 秒や遠い未来の
 * HTTP-date) でも、手動実行の CLI がハングと区別できない長時間の無言 sleep に
 * ならないよう cap する (指数バックオフ側の最大 16s と非対称にしない)。
 */
export const RETRY_WAIT_MAX_MS = 30_000;

/**
 * dev.to API が非 2xx を返した (リトライ不能 or 試行使い切り) ときの typed error。
 * `status` を持つので、呼び出し側が 404 (未公開 / 削除記事) を「その記事だけ skip」と
 * 判別できる (backfill 全体を 1 記事で落とさない)。
 *
 * @graph-connects none
 */
export class DevtoHttpError extends Error {
  constructor(
    readonly status: number,
    readonly label: string,
  ) {
    super(`dev.to fetch failed: ${String(status)} for ${label}`);
    this.name = "DevtoHttpError";
  }
}

/**
 * `Retry-After` ヘッダ (秒数 or HTTP-date) を待機ミリ秒に変換する。解釈できなければ null。
 *
 * @graph-connects none
 */
export function parseRetryAfterMs(headerValue: string | null, nowMs: number): number | null {
  if (!headerValue) return null;
  const secs = Number(headerValue);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const dateMs = Date.parse(headerValue);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - nowMs);
  return null;
}

/**
 * dev.to API を叩いて JSON を返す。429 / 5xx / ネットワーク瞬断は指数バックオフで
 * リトライし、429 は `Retry-After` ヘッダがあればそれを優先する。4xx (429 以外) は
 * 決定的エラーとして即 throw。backfill は全記事を舐めるため 429 でこけないよう挟む。
 *
 * @graph-connects devto [calls] fetch で dev.to API を叩く (一時障害はバックオフ再試行)
 */
export async function fetchDevtoJson(
  url: string,
  label: string,
  opts: FetchRetryOptions = {},
): Promise<unknown> {
  const {
    retries = 4,
    baseDelayMs = 1_000,
    sleep = defaultSleep,
    fetchImpl = fetch,
    now = Date.now,
  } = opts;
  const backoff = (attempt: number): number => baseDelayMs * 2 ** attempt;

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      // ネットワーク / timeout も一時障害としてリトライ (試行を使い切ったら投げる)。
      if (attempt >= retries) throw err;
      await sleep(backoff(attempt));
      continue;
    }
    if (res.ok) return res.json();

    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= retries) {
      throw new DevtoHttpError(res.status, label);
    }
    const retryAfter =
      res.status === 429 ? parseRetryAfterMs(res.headers.get("retry-after"), now()) : null;
    const waitMs = Math.min(retryAfter ?? backoff(attempt), RETRY_WAIT_MAX_MS);
    // 無言 sleep はハングと区別が付かないので、待機理由 (status / 待機 ms) を 1 行出す。
    console.warn(
      `[devto] ${label}: HTTP ${String(res.status)}, retry in ${String(waitMs)}ms (attempt ${String(attempt + 1)}/${String(retries)})`,
    );
    await sleep(waitMs);
  }
}

/**
 * dev.to API で記事のコメントツリーを取得する。認証不要 (public 記事)。
 *
 * @graph-connects devto [calls] GET /api/comments?a_id=<id> でコメントツリーを取得
 */
export async function fetchDevtoComments(
  articleId: number,
  opts: FetchRetryOptions = {},
): Promise<DevtoComment[]> {
  const data = await fetchDevtoJson(
    `https://dev.to/api/comments?a_id=${String(articleId)}`,
    `a_id=${String(articleId)}`,
    opts,
  );
  return parseDevtoComments(data);
}

/** 記事の deep link 構築 / 見出し表示に使う最小メタ。 */
export interface ArticleMeta {
  url: string;
  title: string;
}

/** dev.to 記事 API レスポンスの境界検証 schema (使うフィールドだけを検証)。 */
const devtoArticleSchema = z.object({
  url: z.string().optional(),
  title: z.string().optional(),
});

/**
 * unknown な記事 API レスポンスを ArticleMeta として検証する。url 欠落は deep link を
 * 組めないため明示エラー、title 欠落は article id で代替する。
 *
 * @graph-connects none
 */
export function parseArticleMeta(data: unknown, articleId: number): ArticleMeta {
  const parsed = devtoArticleSchema.parse(data);
  if (!parsed.url) throw new Error(`dev.to article ${String(articleId)} has no url`);
  return { url: parsed.url, title: parsed.title ?? `article ${String(articleId)}` };
}

/**
 * dev.to API で記事の canonical url + title を取得する (deep link / 見出し用)。
 *
 * @graph-connects devto [calls] GET /api/articles/<id> で記事 url / title を取得
 */
export async function fetchArticleMeta(
  articleId: number,
  opts: FetchRetryOptions = {},
): Promise<ArticleMeta> {
  const data = await fetchDevtoJson(
    `https://dev.to/api/articles/${String(articleId)}`,
    `id=${String(articleId)}`,
    opts,
  );
  return parseArticleMeta(data, articleId);
}

/**
 * 記事の canonical url だけを取得する薄いラッパー (import 経路の後方互換)。
 *
 * @graph-connects none
 */
export async function fetchArticleUrl(
  articleId: number,
  opts: FetchRetryOptions = {},
): Promise<string> {
  return (await fetchArticleMeta(articleId, opts)).url;
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
