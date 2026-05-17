/**
 * `sync-r2-images.ts` の CLI entry。CI workflow から `pnpm exec tsx
 * scripts/sync-r2-images.cli.ts` で呼ばれる。
 *
 * 引数:
 * - `--dry-run` (任意): 実 PUT を skip して diff だけ stdout に出す
 *
 * env (必須):
 * - `CLOUDFLARE_ACCOUNT_ID`
 * - `CLOUDFLARE_API_TOKEN` (Workers R2 Storage Write 権限)
 *
 * env (任意):
 * - `R2_BUCKET` (default: `ryantsuji-dev-images`)
 * - `IMAGES_DIR` (default: `apps/ryantsuji-dev/web/content/images`)
 *
 * 終了 code は失敗時のみ非 0、成功時は 0。orphan (= local に無いが remote に残る key)
 * は warn log で出すだけで失敗にはしない (人間が見て手動 delete する想定)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business sync-r2-images の CLI wrapper。CI deploy workflow が wrangler deploy 直前に呼ぶ entry point。env から credentials を読み runSync を呼んで stdout で結果を報告
 * @graph-connects none
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { runSync, type FetchLike } from "./sync-r2-images.js";

/**
 * fetch を `FetchLike` 形に正規化する thin wrapper。`globalThis.fetch` を使い、
 * status / text / arrayBuffer の subset interface に揃える。
 *
 * @graph-connects none
 */
const fetchFn: FetchLike = async (url, init) => {
  const res = await globalThis.fetch(url, init as RequestInit);
  return {
    status: res.status,
    text: () => res.text(),
    arrayBuffer: () => res.arrayBuffer(),
  };
};

/** @graph-connects none */
async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) {
    console.error("missing env: CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN");
    process.exit(1);
  }
  const bucket = process.env.R2_BUCKET ?? "ryantsuji-dev-images";
  const imagesDir = resolve(process.env.IMAGES_DIR ?? "apps/ryantsuji-dev/web/content/images");

  console.log(`[sync-r2-images] bucket=${bucket} dir=${imagesDir} dry=${dryRun}`);
  const result = await runSync({
    fetchFn,
    readFile: async (path) => new Uint8Array(await readFile(path)),
    imagesDir,
    accountId,
    bucket,
    token,
    dryRun,
  });
  if (result.uploaded.length === 0) {
    console.log("[sync-r2-images] no changes");
  } else {
    console.log(`[sync-r2-images] uploaded (${result.uploaded.length}):`);
    for (const k of result.uploaded) console.log(`  + ${k}`);
  }
  if (result.orphans.length > 0) {
    console.warn(
      `[sync-r2-images] orphans on R2 (no local source, manual cleanup): ${result.orphans.length}`,
    );
    for (const k of result.orphans) console.warn(`  ? ${k}`);
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
