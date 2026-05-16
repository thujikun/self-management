#!/usr/bin/env tsx
/*
 * syndicate CLI — ryantsuji.dev の content/posts/*.{ja,en}.md を読み、Zenn 用 / dev.to
 * 用にそれぞれ変換した markdown / API article body を `dist/syndication/<target>/...`
 * に書き出す。
 *
 * Phase 1 では **dry-run のみ** (file 出力)。Phase 2 で:
 * - Zenn: `thujikun/ryantsuji-dev-content` repo に commit & push
 * - dev.to: API PUT /api/articles/{id}
 * を自動化する。
 *
 * 使い方:
 *   pnpm tsx scripts/syndicate.ts --target zenn               # 全 .ja.md (dry-run)
 *   pnpm tsx scripts/syndicate.ts --target devto              # 全 .en.md (dry-run)
 *   pnpm tsx scripts/syndicate.ts --target zenn --slug X      # 単一 slug
 *   pnpm tsx scripts/syndicate.ts --target all                # zenn + devto 両方
 *   pnpm tsx scripts/syndicate.ts --target zenn --publish     # Zenn repo に commit & push
 *   pnpm tsx scripts/syndicate.ts --target devto --publish    # dev.to API PUT で更新
 *
 * env:
 *   DEV_TO_API_KEY              dev.to publish に必要 (`--target devto --publish`)
 *   RYANTSUJI_CONTENT_REPO_DIR  Zenn 用 local clone path
 *                               default: ~/Workspace/ryantsuji-dev-content
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business syndicate CLI driver。content/posts から全 post を読み、各 post の frontmatter syndication.{zenn,devto} ID を引いて公開 URL resolver を構築、pipeline で transform した結果を dist/syndication/ に出力する。Phase 1 は file 出力のみ、Phase 2 で publish 自動化を上に乗せる
 * @graph-connects content [reads_from] content/posts の全 .{ja,en}.md を入力
 * @graph-connects syndication [calls] @self/syndication の syndicateForZenn / syndicateForDevto を呼ぶ
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import matter from "gray-matter";
import { parseFrontmatter, type Frontmatter } from "@self/content";
import {
  publishToDevto,
  publishToZenn,
  syndicateForDevto,
  syndicateForZenn,
  type SlugResolver,
} from "@self/syndication";
import { homedir } from "node:os";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPTS_DIR, "..");
const POSTS_DIR = resolve(REPO_ROOT, "apps/ryantsuji-dev/web/content/posts");
const ZENN_FOOTER_PATH = resolve(REPO_ROOT, "packages/syndication/config/footers/zenn.ja.md");
const OUT_DIR = resolve(REPO_ROOT, "dist/syndication");
const ZENN_REPO_REMOTE = "git@github.com:thujikun/ryantsuji-dev-content.git";
const ZENN_REPO_LOCAL_DEFAULT = resolve(homedir(), "Workspace/ryantsuji-dev-content");

/** parse + filename 由来 slug + lang。 */
interface ParsedPost {
  slug: string;
  lang: "ja" | "en";
  meta: Frontmatter;
  body: string;
}

/**
 * content/posts 配下の `<slug>.<lang>.md` を全て parse する。
 */
async function readAllPosts(): Promise<ParsedPost[]> {
  const files = await readdir(POSTS_DIR);
  const out: ParsedPost[] = [];
  for (const f of files) {
    const m = /^([_a-z0-9][_a-z0-9-]*)\.(en|ja)\.md$/i.exec(f);
    if (!m) continue;
    const slug = m[1] as string;
    const lang = m[2] as "ja" | "en";
    const raw = await readFile(resolve(POSTS_DIR, f), "utf8");
    const parsed = matter(raw);
    const meta = parseFrontmatter(parsed.data);
    if (meta.draft) continue;
    out.push({ slug, lang, meta, body: parsed.content });
  }
  return out;
}

/**
 * slug → Zenn 公開 URL の resolver を構築。`.ja.md` の frontmatter
 * `syndication.zenn.id` から逆引きする。
 */
function buildZennResolver(posts: ParsedPost[]): SlugResolver {
  const map = new Map<string, string>();
  for (const p of posts) {
    if (p.lang !== "ja") continue;
    const zennId = p.meta.syndication.zenn?.id;
    if (zennId) {
      map.set(p.slug, `https://zenn.dev/aircloset/articles/${zennId}`);
    }
  }
  return (slug) => map.get(slug) ?? null;
}

/**
 * slug → dev.to 公開 URL の resolver。`.en.md` の `syndication.devto.slug` から。
 */
function buildDevtoResolver(posts: ParsedPost[]): SlugResolver {
  const map = new Map<string, string>();
  for (const p of posts) {
    if (p.lang !== "en") continue;
    const d = p.meta.syndication.devto;
    if (d) {
      map.set(p.slug, `https://dev.to/ryantsuji/${d.slug}`);
    }
  }
  return (slug) => map.get(slug) ?? null;
}

/** Zenn 変換: 全 .ja.md を Zenn 用に書き出す + 任意で repo に commit/push。 */
async function emitZenn(
  posts: ParsedPost[],
  filter: { slug?: string; publish: boolean },
): Promise<void> {
  const resolver = buildZennResolver(posts);
  const footer = await readFile(ZENN_FOOTER_PATH, "utf8");
  const outDir = resolve(OUT_DIR, "zenn");
  await mkdir(outDir, { recursive: true });
  const repoDir = process.env.RYANTSUJI_CONTENT_REPO_DIR ?? ZENN_REPO_LOCAL_DEFAULT;

  for (const p of posts) {
    if (p.lang !== "ja") continue;
    if (filter.slug && p.slug !== filter.slug) continue;
    const zennId = p.meta.syndication.zenn?.id;
    if (!zennId) {
      console.warn(`  [skip] ${p.slug}.ja.md: no syndication.zenn.id`);
      continue;
    }
    const markdown = syndicateForZenn({
      meta: p.meta,
      body: p.body,
      resolver,
      footerMarkdown: footer,
    });
    const outPath = resolve(outDir, `${zennId}.md`);
    await writeFile(outPath, markdown, "utf8");
    console.log(`  zenn:  ${p.slug} → ${outPath}`);

    if (filter.publish) {
      const result = await publishToZenn({
        repoDir,
        remoteUrl: ZENN_REPO_REMOTE,
        zennId,
        markdown,
        commitSubject: `chore: sync ${p.slug} (${zennId})`,
      });
      console.log(
        `    publish: ${result.pushed ? `pushed ${result.commitSha?.slice(0, 8)}` : "no change"}`,
      );
    }
  }
}

/** dev.to 変換: 全 .en.md を API article attributes として JSON で書き出す + 任意で PUT publish。 */
async function emitDevto(
  posts: ParsedPost[],
  filter: { slug?: string; publish: boolean },
): Promise<void> {
  const resolver = buildDevtoResolver(posts);
  const outDir = resolve(OUT_DIR, "devto");
  await mkdir(outDir, { recursive: true });
  const apiKey = filter.publish ? process.env.DEV_TO_API_KEY : undefined;
  if (filter.publish && !apiKey) {
    throw new Error("--publish requires DEV_TO_API_KEY env");
  }

  for (const p of posts) {
    if (p.lang !== "en") continue;
    if (filter.slug && p.slug !== filter.slug) continue;
    const devto = p.meta.syndication.devto;
    if (!devto) {
      console.warn(`  [skip] ${p.slug}.en.md: no syndication.devto`);
      continue;
    }
    const article = syndicateForDevto({
      meta: p.meta,
      body: p.body,
      slug: p.slug,
      resolver,
      canonicalHost: "https://ryantsuji.dev",
      coverImageUrl: p.meta.cover ? `https://ryantsuji.dev${p.meta.cover}` : undefined,
    });
    const outPath = resolve(outDir, `${p.slug}.json`);
    await writeFile(outPath, JSON.stringify({ id: devto.id, article }, null, 2) + "\n", "utf8");
    console.log(`  devto: ${p.slug} → ${outPath}`);

    if (filter.publish && apiKey) {
      const result = await publishToDevto({ apiKey, articleId: devto.id, article });
      console.log(`    publish: ${result.url}`);
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const targetIdx = args.indexOf("--target");
  const target = targetIdx >= 0 ? args[targetIdx + 1] : "all";
  const slugIdx = args.indexOf("--slug");
  const slug = slugIdx >= 0 ? args[slugIdx + 1] : undefined;
  const publish = args.includes("--publish");
  if (target !== "zenn" && target !== "devto" && target !== "all") {
    console.error(`unknown --target: ${target} (zenn | devto | all)`);
    process.exit(1);
  }

  const posts = await readAllPosts();
  console.log(
    `loaded ${posts.length} posts (target=${target}${slug ? `, slug=${slug}` : ""}${publish ? ", publish" : ", dry-run"})`,
  );

  if (target === "zenn" || target === "all") {
    await emitZenn(posts, { slug, publish });
  }
  if (target === "devto" || target === "all") {
    await emitDevto(posts, { slug, publish });
  }
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
