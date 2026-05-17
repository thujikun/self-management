/**
 * dev.to API publish 層。既存記事を `PUT /api/articles/{id}` で更新、新規記事を
 * `POST /api/articles` で作成する。
 *
 * - 認証: `api-key` ヘッダー (`DEV_TO_API_KEY` env から)
 * - rate limit: ~30 req / 30 sec。429 で 5 回まで exponential backoff
 *   (2s, 4s, 8s, 16s, 32s)
 * - dryRun: true で実際の API call をせず、構築 body を console に print
 *
 * 新規記事の create (`createDevtoArticle`) は POST で id + slug を取得して返す。
 * CLI 層は戻り値を frontmatter `syndication.devto.{id, slug}` に書き戻す。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business dev.to API publish 層。既存記事は PUT で更新、新規記事は POST で作成。rate limit に対する 429 retry と auth ヘッダー設定を集約、CLI からは pure に「id + attribute object + API key」だけ渡せば update / create される
 * @graph-connects none
 */

import type { DevtoArticleAttributes } from "../devto-frontmatter.js";

/** @graph-connects none */
export interface PublishDevtoArgs {
  apiKey: string;
  articleId: number;
  article: DevtoArticleAttributes;
  /** dry-run の時は HTTP request を投げず、構築 body を console に print */
  dryRun?: boolean;
  /** retry 時の sleep injection (test では即解決の Promise を渡せば backoff 待たない) */
  sleepFn?: (ms: number) => Promise<void>;
}

/** @graph-connects none */
export interface PublishDevtoResult {
  url: string;
  editedAt: string | null;
}

/**
 * dev.to に既存記事を PUT で更新。
 *
 * @graph-connects none
 */
export async function publishToDevto(args: PublishDevtoArgs): Promise<PublishDevtoResult> {
  const body = JSON.stringify({ article: args.article });
  if (args.dryRun) {
    return { url: `https://dev.to/articles/${args.articleId} (dry-run)`, editedAt: null };
  }
  const sleepFn = args.sleepFn ?? defaultSleep;
  let attempt = 0;
  while (true) {
    const res = await fetch(`https://dev.to/api/articles/${args.articleId}`, {
      method: "PUT",
      headers: {
        "api-key": args.apiKey,
        "Content-Type": "application/json",
        "User-Agent": "ryantsuji-dev-syndication",
      },
      body,
    });
    if (res.ok) {
      const json = (await res.json()) as { url: string; edited_at: string | null };
      return { url: json.url, editedAt: json.edited_at };
    }
    if (res.status === 429 && attempt < 5) {
      const backoff = 2000 * 2 ** attempt;
      await sleepFn(backoff);
      attempt += 1;
      continue;
    }
    const text = await res.text();
    throw new Error(`dev.to PUT ${args.articleId} failed: ${res.status} ${text}`);
  }
}

/** @graph-connects none */
export interface CreateDevtoArgs {
  apiKey: string;
  article: DevtoArticleAttributes;
  /** dry-run の時は POST せず、固定の dummy id / slug を返す */
  dryRun?: boolean;
  /** retry 時の sleep injection (test 用) */
  sleepFn?: (ms: number) => Promise<void>;
}

/** @graph-connects none */
export interface CreateDevtoResult {
  id: number;
  slug: string;
  url: string;
}

/**
 * dev.to に新規記事を POST で作成。返却された id / slug を呼び出し側で frontmatter
 * `syndication.devto.{id, slug}` に書き戻すことで、以降は `publishToDevto` の PUT 経路で
 * update できる。dev.to は POST 後ただちに記事を publish するため、draft 状態にしたい
 * 場合は article body の `published: false` を渡しておく (= `meta.draft: true` から
 * 派生する DevtoArticleAttributes が自動的に false を載せる)。
 *
 * @graph-connects none
 */
export async function createDevtoArticle(args: CreateDevtoArgs): Promise<CreateDevtoResult> {
  if (args.dryRun) {
    return {
      id: -1,
      slug: "dry-run-slug",
      url: "https://dev.to/articles/dry-run (dry-run)",
    };
  }
  const body = JSON.stringify({ article: args.article });
  const sleepFn = args.sleepFn ?? defaultSleep;
  let attempt = 0;
  while (true) {
    const res = await fetch("https://dev.to/api/articles", {
      method: "POST",
      headers: {
        "api-key": args.apiKey,
        "Content-Type": "application/json",
        "User-Agent": "ryantsuji-dev-syndication",
      },
      body,
    });
    if (res.ok) {
      const json = (await res.json()) as { id: number; slug: string; url: string };
      return { id: json.id, slug: json.slug, url: json.url };
    }
    if (res.status === 429 && attempt < 5) {
      await sleepFn(2000 * 2 ** attempt);
      attempt += 1;
      continue;
    }
    const text = await res.text();
    throw new Error(`dev.to POST failed: ${res.status} ${text}`);
  }
}

/** @graph-connects none */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
