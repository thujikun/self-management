/*
 * syndicate logic — content/posts/*.{ja,en}.md を Zenn / dev.to 用に変換して
 * `dist/syndication/<target>/...` に書き出す純粋寄り logic 層。
 *
 * filesystem I/O は最小限 (readdir / readFile / mkdir / writeFile) に留め、
 * 副作用ありの helper も argv / process.exit に依存しないシグネチャに揃える
 * (CLI entry は `scripts/syndicate.cli.ts` 側に分離)。
 *
 * Phase 1 では **dry-run のみ** (file 出力)。Phase 2 で:
 * - Zenn: `thujikun/ryantsuji-dev-content` repo に commit & push
 * - dev.to: API PUT /api/articles/{id}
 * を自動化する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business syndicate logic 層。content/posts から全 post を読み、各 post の frontmatter syndication.{zenn,devto} ID を引いて公開 URL resolver を構築、pipeline で transform した結果を dist/syndication/ に書き出す。Phase 1 は file 出力のみ、Phase 2 で publish 自動化を上に乗せる
 * @graph-connects content [reads_from] content/posts の全 .{ja,en}.md を入力
 * @graph-connects syndication [calls] @self/syndication の syndicateForZenn / syndicateForDevto を呼ぶ
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
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

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPTS_DIR, "..");

export const POSTS_DIR = resolve(REPO_ROOT, "apps/ryantsuji-dev/web/content/posts");
export const ZENN_FOOTER_PATH = resolve(
  REPO_ROOT,
  "packages/syndication/config/footers/zenn.ja.md",
);
export const OUT_DIR = resolve(REPO_ROOT, "dist/syndication");

// publication 識別子は grep で局在化したい (handle 変更 / publication 増減で参照点が散らばらないように)。
// Phase 2 で実 publish 経路 (Zenn repo push / dev.to API PUT) からも参照する見込み。
export const RYANTSUJI_DEV_BASE = "https://ryantsuji.dev";
export const DEVTO_USER = "ryantsuji";
export const ZENN_PUBLICATION = "aircloset";

export const ZENN_REPO_REMOTE = "git@github.com:thujikun/ryantsuji-dev-content.git";
export const ZENN_REPO_LOCAL_DEFAULT = resolve(homedir(), "Workspace/ryantsuji-dev-content");

/** parse + filename 由来 slug + lang。 */
export interface ParsedPost {
  slug: string;
  lang: "ja" | "en";
  meta: Frontmatter;
  body: string;
}

/**
 * `<slug>.<lang>.md` のファイル名を slug + lang に分解。
 *
 * slug は本 repo 規約 `[_a-z0-9-]` のみを許容 (大文字混じりは match させない)。
 * `link-rewriter.ts` の `/g` flag と同じ判断 — 大文字混じり filename を silently
 * 受け入れて resolver map で小文字側と衝突 / miss するのを防ぐ。
 */
export function parseFileName(name: string): { slug: string; lang: "ja" | "en" } | null {
  const m = /^([_a-z0-9][_a-z0-9-]*)\.(en|ja)\.md$/u.exec(name);
  if (!m) return null;
  return { slug: m[1] as string, lang: m[2] as "ja" | "en" };
}

/**
 * `postsDir` 配下の `<slug>.<lang>.md` を全て parse する。`draft: true` は除外。
 */
export async function readAllPosts(postsDir: string = POSTS_DIR): Promise<ParsedPost[]> {
  const files = await readdir(postsDir);
  const out: ParsedPost[] = [];
  for (const f of files) {
    const parsed = parseFileName(f);
    if (!parsed) continue;
    const raw = await readFile(resolve(postsDir, f), "utf8");
    const grayMatter = matter(raw);
    const meta = parseFrontmatter(grayMatter.data);
    if (meta.draft) continue;
    out.push({ slug: parsed.slug, lang: parsed.lang, meta, body: grayMatter.content });
  }
  return out;
}

/**
 * slug → Zenn 公開 URL の resolver を構築。`.ja.md` の frontmatter
 * `syndication.zenn.id` から逆引きする。
 */
export function buildZennResolver(posts: ParsedPost[]): SlugResolver {
  const map = new Map<string, string>();
  for (const p of posts) {
    if (p.lang !== "ja") continue;
    const zennId = p.meta.syndication.zenn?.id;
    if (zennId) {
      map.set(p.slug, `https://zenn.dev/${ZENN_PUBLICATION}/articles/${zennId}`);
    }
  }
  return (slug) => map.get(slug) ?? null;
}

/**
 * slug → dev.to 公開 URL の resolver。`.en.md` の `syndication.devto.slug` から。
 */
export function buildDevtoResolver(posts: ParsedPost[]): SlugResolver {
  const map = new Map<string, string>();
  for (const p of posts) {
    if (p.lang !== "en") continue;
    const d = p.meta.syndication.devto;
    if (d) {
      map.set(p.slug, `https://dev.to/${DEVTO_USER}/${d.slug}`);
    }
  }
  return (slug) => map.get(slug) ?? null;
}

/** {@link emitZenn} の引数。 */
export interface EmitZennArgs {
  posts: ParsedPost[];
  /** 出力先 dir (例: `dist/syndication/zenn`)。事前に存在しなくても mkdir で作成。 */
  outDir: string;
  /** Zenn 末尾に付加する footer markdown。 */
  footer: string;
  /** 指定したら一致する slug の post のみ処理。 */
  slug?: string;
  /** true の場合は書き出し後に Zenn repo に commit & push する。 */
  publish: boolean;
  /** Zenn 用 local clone path。default: `$RYANTSUJI_CONTENT_REPO_DIR` → `~/Workspace/ryantsuji-dev-content`。 */
  repoDir?: string;
}

/** Zenn 変換: 全 .ja.md を Zenn 用に書き出す + 任意で repo に commit/push。 */
export async function emitZenn(args: EmitZennArgs): Promise<void> {
  const resolver = buildZennResolver(args.posts);
  await mkdir(args.outDir, { recursive: true });
  const repoDir = args.repoDir ?? process.env.RYANTSUJI_CONTENT_REPO_DIR ?? ZENN_REPO_LOCAL_DEFAULT;

  for (const p of args.posts) {
    if (p.lang !== "ja") continue;
    if (args.slug && p.slug !== args.slug) continue;
    const zennId = p.meta.syndication.zenn?.id;
    if (!zennId) {
      console.warn(`  [skip] ${p.slug}.ja.md: no syndication.zenn.id`);
      continue;
    }
    const markdown = syndicateForZenn({
      meta: p.meta,
      body: p.body,
      resolver,
      footerMarkdown: args.footer,
    });
    const outPath = resolve(args.outDir, `${zennId}.md`);
    await writeFile(outPath, markdown, "utf8");
    console.log(`  zenn:  ${p.slug} → ${outPath}`);

    if (args.publish) {
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

/** {@link emitDevto} の引数。 */
export interface EmitDevtoArgs {
  posts: ParsedPost[];
  /** 出力先 dir (例: `dist/syndication/devto`)。事前に存在しなくても mkdir で作成。 */
  outDir: string;
  /** 指定したら一致する slug の post のみ処理。 */
  slug?: string;
  /** true の場合は出力後に dev.to API PUT で更新する。 */
  publish: boolean;
  /** dev.to API key。default: `$DEV_TO_API_KEY`。`publish` 時のみ必要。 */
  apiKey?: string;
}

/** dev.to 変換: 全 .en.md を API article attributes として JSON で書き出す + 任意で PUT publish。 */
export async function emitDevto(args: EmitDevtoArgs): Promise<void> {
  const resolver = buildDevtoResolver(args.posts);
  await mkdir(args.outDir, { recursive: true });
  const apiKey = args.publish ? (args.apiKey ?? process.env.DEV_TO_API_KEY) : undefined;
  if (args.publish && !apiKey) {
    throw new Error("--publish requires DEV_TO_API_KEY env");
  }

  for (const p of args.posts) {
    if (p.lang !== "en") continue;
    if (args.slug && p.slug !== args.slug) continue;
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
      canonicalHost: RYANTSUJI_DEV_BASE,
      coverImageUrl: p.meta.cover ? `${RYANTSUJI_DEV_BASE}${p.meta.cover}` : undefined,
    });
    const outPath = resolve(args.outDir, `${p.slug}.json`);
    await writeFile(outPath, JSON.stringify({ id: devto.id, article }, null, 2) + "\n", "utf8");
    console.log(`  devto: ${p.slug} → ${outPath}`);

    if (args.publish && apiKey) {
      const result = await publishToDevto({ apiKey, articleId: devto.id, article });
      console.log(`    publish: ${result.url}`);
    }
  }
}
