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

import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import matter from "gray-matter";
import { parseFrontmatter, type Frontmatter } from "@self/content";
import {
  createDevtoArticle,
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
 * `postsDir` 配下の `<slug>.<lang>.md` を全て parse する。`draft: true` は default で
 * 除外するが、`includeDrafts: true` を指定すると drafts も含めて返す。draft 記事を
 * Zenn / dev.to 側に「下書き状態」で同期して、連携 pipeline の挙動を本番記事に影響
 * させずに検証する用途を想定 (`published: !meta.draft` が target frontmatter で評価
 * され、`published: false` 扱いになる)。
 */
export async function readAllPosts(
  postsDir: string = POSTS_DIR,
  options: { includeDrafts?: boolean } = {},
): Promise<ParsedPost[]> {
  const files = await readdir(postsDir);
  const out: ParsedPost[] = [];
  for (const f of files) {
    const parsed = parseFileName(f);
    if (!parsed) continue;
    const raw = await readFile(resolve(postsDir, f), "utf8");
    const grayMatter = matter(raw);
    const meta = parseFrontmatter(grayMatter.data);
    if (meta.draft && !options.includeDrafts) continue;
    out.push({ slug: parsed.slug, lang: parsed.lang, meta, body: grayMatter.content });
  }
  return out;
}

/**
 * source .md ファイルの frontmatter に `syndication.zenn.id` を書き加える。
 *
 * gray-matter で parse → data 操作 → stringify する代わりに、YAML を直接 surgical に
 * 編集する (round-trip による format drift を避けるため)。`syndication:` block 内に
 * `zenn:` subkey が無い前提で、新規 block を append する。既存 `zenn.id` の上書きは
 * 想定しない (= 二重 create の防御として呼び出し側が事前 check する)。
 *
 * @graph-connects none
 */
export async function writebackZennIdToFile(file: string, zennId: string): Promise<void> {
  const raw = await readFile(file, "utf8");
  const insertion = `  zenn:\n    id: "${zennId}"\n`;
  if (/^syndication:/m.test(raw)) {
    // `syndication:` の直後に挿入 (sub-key の他に何か有っても先頭の zenn として並ぶ)
    const updated = raw.replace(/(^syndication:[ \t]*\n)/m, `$1${insertion}`);
    await writeFile(file, updated, "utf8");
    return;
  }
  // `syndication:` block 自体が無いケース: frontmatter 末尾 (closing `---`) の手前に挿入
  const updated = raw.replace(/(\n)(---\n)/, `$1syndication:\n${insertion}$2`);
  await writeFile(file, updated, "utf8");
}

/**
 * source .md ファイルの frontmatter に `syndication.devto.{id, slug}` を書き加える。
 * 規約は `writebackZennIdToFile` と同じ (YAML を surgical に編集して format drift を避ける)。
 *
 * @graph-connects none
 */
export async function writebackDevtoToFile(
  file: string,
  devtoId: number,
  devtoSlug: string,
): Promise<void> {
  const raw = await readFile(file, "utf8");
  const insertion = `  devto:\n    id: ${devtoId}\n    slug: "${devtoSlug}"\n`;
  if (/^syndication:/m.test(raw)) {
    const updated = raw.replace(/(^syndication:[ \t]*\n)/m, `$1${insertion}`);
    await writeFile(file, updated, "utf8");
    return;
  }
  const updated = raw.replace(/(\n)(---\n)/, `$1syndication:\n${insertion}$2`);
  await writeFile(file, updated, "utf8");
}

/**
 * 14 char hex の Zenn article ID を生成 (`crypto.randomBytes(7)` → hex)。
 *
 * @graph-connects none
 */
export function generateZennId(): string {
  return randomBytes(7).toString("hex");
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
  // 同 slug の en variant 存在を SET で持ち、ja syndication 時に enUrl を組む。
  // dev.to は canonical_url で原典を出せるが Zenn には無いので、Zenn だけ header で
  // 「English version on ryantsuji.dev」を表示する。
  const slugsWithEn = new Set(args.posts.filter((q) => q.lang === "en").map((q) => q.slug));

  for (const p of args.posts) {
    if (p.lang !== "ja") continue;
    if (args.slug && p.slug !== args.slug) continue;
    let zennId = p.meta.syndication.zenn?.id;
    if (!zennId) {
      if (!args.publish) {
        console.warn(`  [skip] ${p.slug}.ja.md: no syndication.zenn.id (dry-run)`);
        continue;
      }
      // publish mode で id が無い場合は新規 article として hex を生成 → frontmatter に
      // 書き戻し → 以後の syndicate でこの id が使われる。
      zennId = generateZennId();
      const srcFile = resolve(POSTS_DIR, `${p.slug}.ja.md`);
      await writebackZennIdToFile(srcFile, zennId);
      console.log(`  [create] ${p.slug}.ja.md: generated zenn id=${zennId}`);
    }
    const enUrl = slugsWithEn.has(p.slug) ? `${RYANTSUJI_DEV_BASE}/posts/${p.slug}?lang=en` : null;
    const markdown = syndicateForZenn({
      meta: p.meta,
      body: p.body,
      resolver,
      canonicalHost: RYANTSUJI_DEV_BASE,
      enUrl,
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
    let devto = p.meta.syndication.devto;
    const article = syndicateForDevto({
      meta: p.meta,
      body: p.body,
      slug: p.slug,
      resolver,
      canonicalHost: RYANTSUJI_DEV_BASE,
      coverImageUrl: p.meta.cover ? `${RYANTSUJI_DEV_BASE}${p.meta.cover}` : undefined,
    });

    if (!devto) {
      if (!args.publish || !apiKey) {
        console.warn(`  [skip] ${p.slug}.en.md: no syndication.devto (dry-run or no API key)`);
        continue;
      }
      // publish mode で devto entry が無い場合は POST で article 作成 → id + slug を
      // frontmatter に書き戻し → 以後の syndicate で update 経路に乗る。
      const created = await createDevtoArticle({ apiKey, article });
      devto = { id: created.id, slug: created.slug };
      const srcFile = resolve(POSTS_DIR, `${p.slug}.en.md`);
      await writebackDevtoToFile(srcFile, created.id, created.slug);
      console.log(
        `  [create] ${p.slug}.en.md: dev.to article created id=${created.id} slug=${created.slug}`,
      );
    }

    const outPath = resolve(args.outDir, `${p.slug}.json`);
    await writeFile(outPath, JSON.stringify({ id: devto.id, article }, null, 2) + "\n", "utf8");
    console.log(`  devto: ${p.slug} → ${outPath}`);

    if (args.publish && apiKey) {
      const result = await publishToDevto({ apiKey, articleId: devto.id, article });
      console.log(`    publish: ${result.url}`);
    }
  }
}
