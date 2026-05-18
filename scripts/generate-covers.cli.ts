#!/usr/bin/env tsx
/*
 * generate-covers CLI thin entry。argv を parse して `generate-covers.ts` の
 * logic を呼ぶだけ。process.argv / process.exit / 標準出力依存の glue を test
 * 対象から逃がす compact-log / syndicate と同じ分離パターン。
 *
 * 使い方:
 *   pnpm tsx scripts/generate-covers.cli.ts                       # 全 post (frontmatter も書き戻し)
 *   pnpm tsx scripts/generate-covers.cli.ts --slug X              # 単一 slug
 *   pnpm tsx scripts/generate-covers.cli.ts --no-frontmatter      # PNG のみ生成、md は触らない
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business generate-covers CLI entry。argv parse して全 post 分の og:image を生成、frontmatter.cover を書き戻す。PNG は public/posts/ 配下に出力される
 * @graph-connects none
 */

import { generateAllCovers, loadOgFonts, readAllPosts } from "./generate-covers.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const slugIdx = args.indexOf("--slug");
  const slug = slugIdx >= 0 ? args[slugIdx + 1] : undefined;
  const writeFrontmatter = !args.includes("--no-frontmatter");

  console.log("[og-image] loading fonts (cache-or-fetch)...");
  const fonts = await loadOgFonts();

  console.log("[og-image] reading posts...");
  // og:image は syndication 可否に関わらず全 post に対して生成する
  // (ryantsuji.dev 限定 post も unfurl で固有 cover を出すため)
  const posts = await readAllPosts(undefined, { includeExcluded: true });
  console.log(`[og-image] ${posts.length} post entries (slug filter: ${slug ?? "none"})`);

  const results = await generateAllCovers({ posts, fonts, slug, writeFrontmatter });
  for (const r of results) {
    const fm = r.frontmatterUpdated ? "(frontmatter updated)" : "";
    console.log(`  [ok] ${r.slug}.${r.lang} → ${r.publicPath} ${fm}`);
  }
  console.log(`[og-image] done: ${results.length} cover(s) generated`);
}

await main();
