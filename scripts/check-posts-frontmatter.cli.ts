#!/usr/bin/env tsx
/*
 * check-posts-frontmatter CLI thin entry。content/posts/ 配下の全 `.md` を列挙し、
 * `@self/content` の `parseFrontmatter` で frontmatter を検証、schema 違反があれば
 * exit 1 で fail させる。draft も含め全 post を検証する (rendered-posts plugin は
 * build 時に draft も parse するため)。
 *
 * 列挙対象は rendered-posts plugin の `renderAllPosts` と同じ「全 `.md`」に揃える。
 * gate の存在意義は build の parse 失敗を bump PR CI で先回りして弾くことなので、
 * parse 対象集合が build より狭いと規約外 `.md` (README.md / 大文字混じり / lang 欠落
 * 等) を取りこぼし、gate green のまま deploy が壊れた pointer を main に通してしまう。
 *
 * 使い方:
 *   pnpm tsx scripts/check-posts-frontmatter.cli.ts   # 全 post を検証
 *
 * gates.sh の `posts-frontmatter` gate (CI full) から呼ばれる。`@self/content` の
 * dist を要するため gate 側で先に build する。
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business check-posts-frontmatter の filesystem 実行 entry。content/posts を全列挙し gray-matter で frontmatter を抽出、@self/content の parseFrontmatter で検証して違反を file:message で報告する。malformed frontmatter による site build / deploy 全体 fail を bump PR CI で未然に弾く
 * @graph-connects content [calls] parseFrontmatter で frontmatter を schema 検証
 */

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import matter from "gray-matter";
import { parseFrontmatter } from "@self/content";

import { collectFrontmatterViolations, type PostFrontmatter } from "./check-posts-frontmatter.js";
import { POSTS_DIR } from "./posts-files.js";

async function main(): Promise<void> {
  const files = await readdir(POSTS_DIR);
  const posts: PostFrontmatter[] = [];
  for (const f of files) {
    // build (rendered-posts plugin の renderAllPosts) と同じ parse 対象集合に揃える。
    // parseFileName の slug 規約で絞ると build の方が permissive になり gate が真部分集合化する。
    if (!f.endsWith(".md")) continue;
    const raw = await readFile(resolve(POSTS_DIR, f), "utf8");
    posts.push({ file: f, data: matter(raw).data });
  }

  const violations = collectFrontmatterViolations(posts, (data) => {
    parseFrontmatter(data);
  });

  if (violations.length === 0) {
    console.log(`✓ frontmatter valid for all ${posts.length} post files`);
    return;
  }

  console.error(`❌ ${violations.length} post(s) with invalid frontmatter:`);
  for (const v of violations) {
    console.error(`  - ${v.file}: ${v.message}`);
  }
  console.error(
    "\nfrontmatter は @self/content の schema に従う必要があります " +
      "(site build がこれで全 post を parse するため、違反は deploy 全体を落とす)。",
  );
  process.exit(1);
}

await main();
