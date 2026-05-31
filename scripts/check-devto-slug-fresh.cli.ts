#!/usr/bin/env tsx
/*
 * check-devto-slug-fresh CLI thin entry。content/posts/*.en.md を全列挙し、
 * frontmatter `syndication.devto.slug` に `-temp-slug-NNNNN` を抱えたまま dev.to
 * 公開時刻を過ぎた post を violation として exit 1 で fail させる。
 *
 * Sensor (syndicate.ts:emitDevto の PUT-time slug reconcile) が当たらない window
 * — publish 直後から次の body 変更までの間 — に stored slug が腐ったままになる
 * 状態を CI で block する Guide。実行例:
 *
 *   pnpm tsx scripts/check-devto-slug-fresh.cli.ts   # 全 .en.md を検査
 *
 * fail した場合の手当:
 *   - 単発 (= 1 記事だけ): dev.to API で当該 article を GET → `slug` を frontmatter
 *     に反映、もしくは body を 1 文字変えて push して PUT-reconcile を起こす
 *   - 複数: `pnpm tsx scripts/syndicate.cli.ts --publish` を 1 度走らせると body 変更
 *     のある post は PUT 経由で勝手に直る
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain infra
 * @graph-business check-devto-slug-fresh の filesystem 実行 entry。content/posts/*.en.md を列挙し、syndication.devto.slug の -temp-slug- 残留 (= publish 時刻を過ぎているのに draft 時暫定 slug のまま) を file:slug:publishAt で報告する。PUT-time reconcile が当たらないウィンドウで stored slug が腐り link-rewriter が 404 を埋め込む事故を CI で block する
 * @graph-connects content [calls] check-devto-slug-fresh の collectStaleSlugViolations を呼ぶ
 */

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import matter from "gray-matter";
import { parseFrontmatter } from "@self/content";

import { collectStaleSlugViolations, type DevtoSlugCheckPost } from "./check-devto-slug-fresh.js";
import { POSTS_DIR, parseFileName } from "./posts-files.js";

async function main(): Promise<void> {
  const files = await readdir(POSTS_DIR);
  const posts: DevtoSlugCheckPost[] = [];
  for (const f of files) {
    if (!f.endsWith(".md")) continue;
    const parsed = parseFileName(f);
    // dev.to syndicate 対象は .en だけ。.ja / fixture (`_` prefix) はスキップ。
    if (!parsed || parsed.lang !== "en") continue;
    if (parsed.slug.startsWith("_")) continue;

    const raw = await readFile(resolve(POSTS_DIR, f), "utf8");
    const data = matter(raw).data;
    let meta;
    try {
      meta = parseFrontmatter(data);
    } catch {
      // frontmatter 不正は check-posts-frontmatter gate の責務なので本 gate はスルー
      continue;
    }
    posts.push({
      file: f,
      devtoSlug: meta.syndication?.devto?.slug,
      // dev.to 公開時刻は devto.publishAt 優先 (媒体ごとに publish 時刻を後ろにずらす運用)、
      // 未設定なら ryantsuji.dev の publishedAt にフォールバック (= 同時公開)。
      publishAt: meta.syndication?.devto?.publishAt ?? meta.publishedAt,
    });
  }

  const violations = collectStaleSlugViolations(posts, new Date());

  if (violations.length === 0) {
    console.log(`✓ devto.slug fresh for all ${posts.length} .en posts`);
    return;
  }

  console.error(`❌ ${violations.length} .en post(s) with stale "-temp-slug-" in devto.slug:`);
  for (const v of violations) {
    console.error(`  - ${v.file}: ${v.slug} (publishAt=${v.publishAt})`);
  }
  console.error(
    "\ndev.to は draft → 公開時に -temp-slug-NNNNN 付きの暫定 slug を canonical に剥がしますが、\n" +
      "API は通知してくれません。stored slug の reconcile は syndicate.ts:emitDevto が PUT 応答\n" +
      "から自動で行いますが、PUT は contentHash 一致時に skip するため publish 直後の窓では\n" +
      "stored slug が腐ったままになります。直し方:\n" +
      "  - body を 1 文字変えて push → PUT が走り auto-reconcile される\n" +
      "  - もしくは dev.to API で当該 article を GET し slug を frontmatter に反映",
  );
  process.exit(1);
}

await main();
