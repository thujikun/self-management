/**
 * X tweet 本文から検出した URL を、既存 contents (zenn/devto/...) と `references`
 * edge で繋ぐ post-processor。
 *
 * 例: 「DB Graph MCP の記事公開した https://dev.to/.../democratizing-...」 という X tweet
 * → dev.to の "Democratizing Internal Data" content に `references` edge を張る
 *
 * t.co だけで shortened されてる URL はマッチしないが、Ryan が full URL も貼ってる
 * ケース (=多くの記事 share tweet) を捕捉できる。完全マッチは 4i-extension で
 * t.co resolver か X API entities.urls 経由で対応予定。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business X tweet と Zenn/dev.to 記事を URL 一致で繋ぐ post-processor。クロスプラットフォーム graph 探索 (X 投稿 → 元記事 → 同記事を share した他 tweet) を可能にする
 * @graph-connects none
 */

import { BigQuery } from "@google-cloud/bigquery";
import { BQ_DATASET } from "../../../schema/shared.js";
import type { EdgeInput, NodeInput } from "../common/types.js";

/** @graph-connects none */
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT ?? "ryan-self-management";
/** @graph-connects none */
const LOCATION = "asia-northeast1";

/** BQ client interface (test inject 可)。 */
export interface BqQueryClient {
  createQueryJob(req: {
    query: string;
    location: string;
  }): Promise<[{ getQueryResults(): Promise<[Array<Record<string, unknown>>, ...unknown[]]> }, ...unknown[]]>;
}

/**
 * default BigQuery client (本番)。
 *
 * @graph-connects bigquery [reads_from] contents.url 一覧
 */
export function defaultBqClient(): BqQueryClient {
  return new BigQuery({ projectId: PROJECT_ID, location: LOCATION }) as unknown as BqQueryClient;
}

/**
 * 既存 BQ contents の url 列を index 化して返す (--source=x incremental 時に
 * zenn/devto 等他 source の URL を index に含めるため)。
 *
 * @graph-connects bigquery [reads_from] SELECT url, content_id FROM contents
 */
export async function loadUrlIndexFromBq(
  client: BqQueryClient = defaultBqClient(),
): Promise<Map<string, string>> {
  const sql = `
    SELECT url, content_id FROM \`${PROJECT_ID}.${BQ_DATASET}.contents\`
    WHERE url IS NOT NULL
  `;
  const [job] = await client.createQueryJob({ query: sql, location: LOCATION });
  const [rows] = await job.getQueryResults();
  const index = new Map<string, string>();
  for (const row of rows) {
    const url = row.url;
    const contentId = row.content_id;
    if (typeof url === "string" && typeof contentId === "string") {
      index.set(normalizeUrl(url), contentId);
    }
  }
  return index;
}

/**
 * BQ から source='x' な既存 contents (body_md 含む) を取得して NodeInput[] と
 * して返す。Phase 4i の post-process を `--source=zenn` 等メモリに X tweet が
 * 入らない実行モードでも idempotent に効かせるため。
 *
 * @graph-connects bigquery [reads_from] SELECT content_id, body_md, url FROM contents WHERE source='x'
 */
export async function loadXTweetsAsContents(
  client: BqQueryClient = defaultBqClient(),
): Promise<NodeInput[]> {
  const sql = `
    SELECT content_id, body_md, url
    FROM \`${PROJECT_ID}.${BQ_DATASET}.contents\`
    WHERE source = 'x' AND body_md IS NOT NULL AND body_md != ''
  `;
  const [job] = await client.createQueryJob({ query: sql, location: LOCATION });
  const [rows] = await job.getQueryResults();
  const out: NodeInput[] = [];
  for (const row of rows) {
    const id = row.content_id;
    const body = row.body_md;
    if (typeof id !== "string" || typeof body !== "string") continue;
    const url = typeof row.url === "string" ? row.url : null;
    out.push({
      kind: "contents",
      id,
      fields: { content_id: id, source: "x", url, body_md: body },
    });
  }
  return out;
}

/**
 * URL を正規化 (origin + path、末尾 slash と末尾句読点を除去)。
 * クエリ文字列は除外して、bookmark / share でズレやすい部分を吸収。
 *
 * @graph-connects none
 */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url.replace(/[.,;:!?)]+$/, ""));
    return `${u.origin}${u.pathname}`.replace(/\/$/, "").toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/**
 * テキストから URL を抜き出す (http/https のみ、末尾句読点 trim)。
 *
 * @graph-connects none
 */
export function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s)]+/g) ?? [];
  return matches.map((u) => u.replace(/[.,;:!?)]+$/, ""));
}

/** HTTP HEAD で redirect 先 URL を返す。test 用に inject 可能。 */
export type HttpHeadFn = (url: string) => Promise<string>;

/** @graph-connects none */
async function defaultHttpHead(url: string): Promise<string> {
  const res = await fetch(url, { method: "HEAD", redirect: "follow" });
  return res.url;
}

/**
 * `t.co` の short URL 群を HEAD redirect で expanded URL に解決する。
 * 失敗した URL は出力 map に含めない。
 *
 * @graph-connects t-co [calls] HEAD redirect で short URL を解決
 */
export async function resolveTcoUrls(
  urls: string[],
  head: HttpHeadFn = defaultHttpHead,
): Promise<Map<string, string>> {
  const tcos = [...new Set(urls.filter((u) => u.startsWith("https://t.co/")))];
  const out = new Map<string, string>();
  for (const u of tcos) {
    try {
      const expanded = await head(u);
      if (expanded && expanded !== u) out.set(u, expanded);
    } catch {
      // ignore failures (deleted tweet / rate limit / etc.)
    }
  }
  return out;
}

/**
 * contents 配列から URL → content_id の逆引き index を作る。
 *
 * @graph-connects none
 */
export function buildUrlIndex(contents: NodeInput[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const c of contents) {
    if (c.kind !== "contents") continue;
    const url = c.fields.url as string | undefined;
    if (!url) continue;
    index.set(normalizeUrl(url), c.id);
  }
  return index;
}

/**
 * X 由来 content (source=x) の body_md から URL を抽出 → 既存 contents の URL と
 * 一致する場合 `references` edge (X content → article content) を生成。
 *
 * `externalIndex` が渡されたら in-memory contents の index に merge (BQ から事前 load
 * した既存 URL を含めるユースケース)。
 *
 * 同一 (src, tgt) ペアは dedupe、self-reference は skip。
 *
 * @graph-connects none
 */
export function buildUrlReferenceEdges(
  contents: NodeInput[],
  externalIndex?: Map<string, string>,
  tcoMap?: Map<string, string>,
): EdgeInput[] {
  const urlIndex = buildUrlIndex(contents);
  if (externalIndex) {
    for (const [k, v] of externalIndex) {
      if (!urlIndex.has(k)) urlIndex.set(k, v);
    }
  }
  const edges: EdgeInput[] = [];
  const seen = new Set<string>();
  for (const c of contents) {
    if (c.kind !== "contents") continue;
    if (c.fields.source !== "x") continue;
    const text = (c.fields.body_md as string | undefined) ?? "";
    if (!text) continue;
    for (const rawUrl of extractUrls(text)) {
      // t.co の場合は expanded URL も index 検索対象に
      const expanded = tcoMap?.get(rawUrl);
      const candidates = expanded ? [rawUrl, expanded] : [rawUrl];
      let tgtId: string | undefined;
      let matchedUrl = rawUrl;
      for (const cand of candidates) {
        const id = urlIndex.get(normalizeUrl(cand));
        if (id) {
          tgtId = id;
          matchedUrl = cand;
          break;
        }
      }
      if (!tgtId) continue;
      if (tgtId === c.id) continue;
      const key = `${c.id}|${tgtId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        edge_table: "personal_edges",
        edge_type: "references",
        src_kind: "contents",
        src_id: c.id,
        tgt_kind: "contents",
        tgt_id: tgtId,
        properties: {
          via: "url_in_text",
          url: matchedUrl,
          ...(expanded && expanded !== rawUrl ? { tco: rawUrl } : {}),
        },
      });
    }
  }
  return edges;
}

/**
 * contents から body_md の全 t.co URL を集める helper (resolveTcoUrls の入力に使う)。
 *
 * @graph-connects none
 */
export function collectTcoUrls(contents: NodeInput[]): string[] {
  const tcos = new Set<string>();
  for (const c of contents) {
    if (c.kind !== "contents") continue;
    if (c.fields.source !== "x") continue;
    const text = (c.fields.body_md as string | undefined) ?? "";
    for (const u of extractUrls(text)) {
      if (u.startsWith("https://t.co/")) tcos.add(u);
    }
  }
  return [...tcos];
}
