/**
 * `apps/ryantsuji-dev/web/content/images/` を R2 bucket `ryantsuji-dev-images` に
 * 同期する pure logic 層。CLI 用 wrapper は `sync-r2-images.cli.ts` 側。
 *
 * 同期方針:
 * - bucket 内に `_manifest.json` (key → sha256 の Record) を保持し、CI が deploy 直前に
 *   download → local content/images/ から新 manifest を組み立て → diff した key のみ
 *   PUT して bucket に流す
 * - manifest 自体を最後に PUT して bucket 上の権威 manifest を更新
 * - 削除は手動で wrangler r2 object delete (markdown が古い image を参照しなくなったら
 *   人間が消す。自動削除は誤削除リスクが大きいので避ける)
 *
 * R2 access は Cloudflare REST API (`api.cloudflare.com/client/v4/accounts/<id>/r2/...`)
 * を `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` の 2 env で叩く。S3 API 互換層を
 * 使わず REST に閉じる理由は、CI ですでに `CLOUDFLARE_API_TOKEN` を持っていて新 secret
 * を増やさずに済むため。
 *
 * 本 module は pure-ish (I/O 関数を deps として受ける形) にして、test では http fake +
 * fs fake で全 path 網羅できる構造に。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business `content/images/` を R2 bucket に CI sync する純関数群。bucket 上の _manifest.json と local manifest を sha256 で diff し、変更分のみ PUT する idempotent 設計。CI deploy 直前に CLI wrapper 経由で 1 回呼ばれる
 * @graph-connects cloudflare-r2 [writes_to] REST API PUT で object と manifest を上げる
 */

import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";

/**
 * key → sha256 hex の manifest 形。bucket root の `_manifest.json` として保存される。
 *
 * @graph-connects none
 */
export type Manifest = Record<string, string>;

/** @graph-connects none */
export const MANIFEST_KEY = "_manifest.json";

/**
 * 拡張子 → Content-Type mapping。R2 put 時に metadata として保存する。Worker route
 * 側は `writeHttpMetadata` でそのまま Response header に流すため、ここの正確性が
 * 配信時の Content-Type そのものに直結する。
 *
 * @graph-connects none
 */
export function mimeFromExt(ext: string): string {
  const lower = ext.toLowerCase();
  const table: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
  };
  return table[lower] ?? "application/octet-stream";
}

/**
 * filesystem walk。`root` 配下の regular file を再帰的に拾って、`relative(root, ...)`
 * で正規化した相対 path を返す。`_*` で始まる dotfile / underscore-prefix は skip
 * (= R2 manifest と衝突しないよう sentinel として予約)。
 *
 * @graph-connects none
 */
export async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function recur(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith("_") || e.name.startsWith(".")) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) await recur(p);
      else if (e.isFile()) out.push(p);
    }
  }
  try {
    const st = await stat(root);
    if (!st.isDirectory()) return out;
  } catch {
    return out;
  }
  await recur(root);
  return out.map((p) => relative(root, p));
}

/**
 * file content の sha256 hex。manifest の比較単位。
 *
 * @graph-connects none
 */
export async function fileSha256(absPath: string): Promise<string> {
  const buf = await readFile(absPath);
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * local content/images から manifest を組む。walk + sha256 を pipeline 化。
 *
 * @graph-connects none
 */
export async function buildLocalManifest(root: string): Promise<Manifest> {
  const keys = await walkFiles(root);
  const out: Manifest = {};
  for (const key of keys) {
    out[key] = await fileSha256(join(root, key));
  }
  return out;
}

/**
 * remote manifest と local manifest を diff し、PUT すべき key 集合を返す。
 *
 * - local に存在 + remote に無い → add
 * - local に存在 + remote と hash 違う → change
 * - local に無い + remote に存在 → delete *対象ではあるが本 sync では物理削除しない*
 *
 * 戻り値の `toUpload` は add + change の union。`orphans` は monitor 用 (CLI 側で
 * 警告 log する)。
 *
 * @graph-connects none
 */
export function diffManifests(
  local: Manifest,
  remote: Manifest,
): { toUpload: string[]; orphans: string[] } {
  const toUpload: string[] = [];
  for (const [key, hash] of Object.entries(local)) {
    if (remote[key] !== hash) toUpload.push(key);
  }
  const orphans: string[] = [];
  for (const key of Object.keys(remote)) {
    if (!(key in local)) orphans.push(key);
  }
  return { toUpload: toUpload.sort(), orphans: orphans.sort() };
}

/**
 * CF REST API の R2 object endpoint。`<base>/<key>` でそのまま PUT / GET / DELETE。
 *
 * @graph-connects none
 */
export function r2ObjectUrl(accountId: string, bucket: string, key: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects/${encodeURIComponent(key)}`;
}

/**
 * fetch wrapper interface (test では fake で差替えできるよう注入)。
 *
 * @graph-connects none
 */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: BodyInit | null },
) => Promise<{ status: number; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }>;

/**
 * remote manifest を bucket から fetch。404 (= 初回 sync) は空 manifest として返す。
 *
 * @graph-connects cloudflare-r2 [reads_from] GET _manifest.json
 */
export async function fetchRemoteManifest(
  fetchFn: FetchLike,
  accountId: string,
  bucket: string,
  token: string,
): Promise<Manifest> {
  const res = await fetchFn(r2ObjectUrl(accountId, bucket, MANIFEST_KEY), {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return {};
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`manifest fetch failed: ${res.status} ${await res.text()}`);
  }
  const buf = await res.arrayBuffer();
  const text = new TextDecoder().decode(new Uint8Array(buf));
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("manifest is not an object");
  }
  return parsed as Manifest;
}

/**
 * 1 file を PUT。本体は `body` (Uint8Array)、Content-Type は ext から resolve。
 *
 * @graph-connects cloudflare-r2 [writes_to] PUT object
 */
export async function putObject(
  fetchFn: FetchLike,
  accountId: string,
  bucket: string,
  token: string,
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  const res = await fetchFn(r2ObjectUrl(accountId, bucket, key), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": contentType,
    },
    body: body as unknown as BodyInit,
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`put failed (${key}): ${res.status} ${await res.text()}`);
  }
}

/**
 * sync 1 回分の orchestration: remote manifest fetch → local 構築 → diff → 必要な
 * file を PUT → 最後に新 manifest を PUT。dry-run mode は実 PUT を skip して
 * `toUpload` だけ返す (CI 上で diff を見るための観察 mode)。
 *
 * @graph-connects cloudflare-r2 [writes_to] orchestrate manifest + object PUT
 */
export async function runSync(deps: {
  fetchFn: FetchLike;
  readFile: (path: string) => Promise<Uint8Array>;
  imagesDir: string;
  accountId: string;
  bucket: string;
  token: string;
  dryRun: boolean;
}): Promise<{ uploaded: string[]; orphans: string[] }> {
  const [local, remote] = await Promise.all([
    buildLocalManifest(deps.imagesDir),
    fetchRemoteManifest(deps.fetchFn, deps.accountId, deps.bucket, deps.token),
  ]);
  const { toUpload, orphans } = diffManifests(local, remote);

  if (deps.dryRun) {
    return { uploaded: toUpload, orphans };
  }

  for (const key of toUpload) {
    const body = await deps.readFile(join(deps.imagesDir, key));
    await putObject(
      deps.fetchFn,
      deps.accountId,
      deps.bucket,
      deps.token,
      key,
      body,
      mimeFromExt(extname(key)),
    );
  }

  // manifest は変更が 1 件でも発生した場合だけ更新 (= 完全 no-op の時は PUT を
  // skip して無駄な request を減らす)。
  if (toUpload.length > 0) {
    const manifestBody = new TextEncoder().encode(JSON.stringify(local, null, 2));
    await putObject(
      deps.fetchFn,
      deps.accountId,
      deps.bucket,
      deps.token,
      MANIFEST_KEY,
      manifestBody,
      "application/json",
    );
  }

  return { uploaded: toUpload, orphans };
}
