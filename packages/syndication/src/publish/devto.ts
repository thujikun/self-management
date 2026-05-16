/**
 * dev.to API publish 層。`PUT /api/articles/{id}` で既存記事を更新する。
 *
 * - 認証: `api-key` ヘッダー (`DEV_TO_API_KEY` env から)
 * - rate limit: PUT は ~30 req / 30 sec。本関数では retry を 5 回まで exponential
 *   backoff (2s, 4s, 8s, 16s, 32s)
 * - dryRun: true で実際の API call をせず、送る予定の body を返す
 *
 * 新規記事 (まだ dev.to に存在しない post) の POST は本 PR では未対応。frontmatter
 * `syndication.devto.{id,slug}` がある post の更新だけを扱う。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business dev.to API publish 層。既存記事を PUT で更新する。rate limit に対する 429 retry と auth ヘッダー設定を集約、CLI からは pure に「id + attribute object + API key」だけ渡せば update される
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
function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
