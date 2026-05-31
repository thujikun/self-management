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

import { createHash, randomBytes } from "node:crypto";
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
  type DevtoArticleAttributes,
  type SlugResolver,
} from "@self/syndication";

import { POSTS_DIR, parseFileName } from "./posts-files.js";

// `POSTS_DIR` / `parseFileName` の SoT は `posts-files.ts` (= `@self/content` 非依存の
// lightweight 層) に置く。`check-covers-exist.cli.ts` 等の caller は本 file 経由でも
// `posts-files` 直経由でも参照できる二重 import 経路を許容するが、定義 SoT は 1 つ。
export { POSTS_DIR, parseFileName };

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPTS_DIR, "..");
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

/**
 * Zenn sync 用 remote URL の default。local 実行は SSH (`git@github.com:...`) で
 * 鍵認証する想定。CI / 別経路は env `ZENN_REPO_REMOTE` で HTTPS+PAT 等に差し替え可能
 * (CI workflow が `https://<token>@github.com/thujikun/ryantsuji-dev-content.git` を
 * 注入する)。`emitZenn` がこの env を読み取って `publishToZenn` の remoteUrl に渡す。
 */
export const ZENN_REPO_REMOTE_DEFAULT = "git@github.com:thujikun/ryantsuji-dev-content.git";
export const ZENN_REPO_REMOTE = process.env.ZENN_REPO_REMOTE ?? ZENN_REPO_REMOTE_DEFAULT;
export const ZENN_REPO_LOCAL_DEFAULT = resolve(homedir(), "Workspace/ryantsuji-dev-content");

/** parse + filename 由来 slug + lang。 */
export interface ParsedPost {
  slug: string;
  lang: "ja" | "en";
  meta: Frontmatter;
  body: string;
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
  options: { includeDrafts?: boolean; includeExcluded?: boolean } = {},
): Promise<ParsedPost[]> {
  const files = await readdir(postsDir);
  const out: ParsedPost[] = [];
  for (const f of files) {
    const parsed = parseFileName(f);
    if (!parsed) continue;
    // `_` prefix slug は test fixture (e.g. `_draft-example` / `_minimal-fixture`)。
    // listing / detail / scheduler が同 prefix で除外する規約と整合させる。
    // ここで弾かないと `--include-drafts` 経路で dev.to に CREATE されてしまう
    // (= 2026-05-17 16:48Z run 25996825130 で実際に発生したインシデント)。
    if (parsed.slug.startsWith("_")) continue;
    const raw = await readFile(resolve(postsDir, f), "utf8");
    const grayMatter = matter(raw);
    const meta = parseFrontmatter(grayMatter.data);
    if (meta.draft && !options.includeDrafts) continue;
    // `excludeFromSyndication: true` の post は ryantsuji.dev のみに公開し、
    // Zenn / dev.to には流さない。non-syndicate な consumer (= content repo 側
    // `scripts/generate-cover.mjs` 等が同 readAllPosts を読む将来想定) は
    // `includeExcluded: true` で除外を無効化できる。
    if (meta.excludeFromSyndication && !options.includeExcluded) continue;
    out.push({ slug: parsed.slug, lang: parsed.lang, meta, body: grayMatter.content });
  }
  return out;
}

/**
 * `raw` の **frontmatter 領域のみ** を対象に、`syndication:` block へ `blockBody` を挿入する。
 *
 * `^syndication:` を file 全体で multiline match すると、markdown body 中の
 * `syndication:` で始まる行 (解説文 / 表 / コードブロック内の YAML サンプル) にも
 * hit して body 内に挿入が混入する事故が起きる。先頭の `---\n...\n---\n` を切り出して
 * frontmatter 側だけ書き換えることで、body は一切触らない不変式を保つ。
 *
 * @graph-connects none
 */
export function insertSyndicationBlock(raw: string, blockBody: string): string {
  const fmMatch = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  if (!fmMatch) {
    throw new Error("frontmatter delimiter `---\\n...\\n---\\n` not found");
  }
  const fmContent = fmMatch[1] as string;
  const afterFm = raw.slice(fmMatch[0].length);
  if (/^syndication:/m.test(fmContent)) {
    // 既存 `syndication:` block の直後に挿入 (sub-key の他に何か有っても先頭に並ぶ)
    const updatedFm = fmContent.replace(/(^syndication:[ \t]*\n)/m, `$1${blockBody}`);
    return `---\n${updatedFm}\n---\n${afterFm}`;
  }
  // `syndication:` block 自体が無いケース: frontmatter content の末尾に新規 block を append。
  // blockBody は trailing newline 持ちなので、最後の \n は閉じ delim 前の改行になるよう剥がしておく
  const normalized = blockBody.endsWith("\n") ? blockBody.slice(0, -1) : blockBody;
  return `---\n${fmContent}\nsyndication:\n${normalized}\n---\n${afterFm}`;
}

/**
 * frontmatter content (delimiter 抜き) の既存 `  <key>:` block 先頭に `lines` を挿入する。
 * block が存在しなければ `null` を返す (= 呼び出し側が新規作成 path に fallback)。
 *
 * 用途: post を予約だけして (publishAt のみ設定) id/slug 未設定の `devto:` / `zenn:`
 * block に、syndicate の create 後に id/slug を後挿入して publishAt 等を温存する。
 *
 * @graph-connects none
 */
export function insertIntoExistingBlock(
  fmContent: string,
  blockKey: "devto" | "zenn",
  lines: string,
): string | null {
  const re = new RegExp(`^( {2}${blockKey}:[ \\t]*\\n)`, "mu");
  if (!re.test(fmContent)) return null;
  return fmContent.replace(re, `$1${lines}`);
}

/**
 * source .md ファイルの frontmatter に `syndication.zenn.id` を書き加える。
 *
 * gray-matter で parse → data 操作 → stringify する代わりに frontmatter 領域だけを
 * surgical に編集する (round-trip による format drift を避ける)。既存の `zenn:` block
 * (= publishAt だけ予約済) があればその先頭に id を後挿入して publishAt を温存し、
 * 無ければ {@link insertSyndicationBlock} で新規 block を作る。
 *
 * @graph-connects none
 */
export async function writebackZennIdToFile(file: string, zennId: string): Promise<void> {
  const raw = await readFile(file, "utf8");
  const idLine = `    id: "${zennId}"\n`;
  const fmMatch = /^---\n([\s\S]*?)\n---\n/u.exec(raw);
  if (fmMatch) {
    const updated = insertIntoExistingBlock(fmMatch[1] as string, "zenn", idLine);
    if (updated !== null) {
      await writeFile(file, `---\n${updated}\n---\n${raw.slice(fmMatch[0].length)}`, "utf8");
      return;
    }
  }
  await writeFile(file, insertSyndicationBlock(raw, `  zenn:\n${idLine}`), "utf8");
}

/**
 * source .md ファイルの frontmatter に `syndication.devto.{id, slug}` を書き加える。
 * 規約は `writebackZennIdToFile` と同じ。既存の `devto:` block (= publishAt だけ
 * 予約済) があればその先頭に id/slug を後挿入して publishAt を温存し、無ければ
 * {@link insertSyndicationBlock} で新規 block を作る。
 *
 * @graph-connects none
 */
export async function writebackDevtoToFile(
  file: string,
  devtoId: number,
  devtoSlug: string,
  devtoContentHash?: string,
): Promise<void> {
  const raw = await readFile(file, "utf8");
  const hashLine = devtoContentHash ? `    contentHash: "${devtoContentHash}"\n` : "";
  const lines = `    id: ${devtoId}\n    slug: "${devtoSlug}"\n${hashLine}`;
  const fmMatch = /^---\n([\s\S]*?)\n---\n/u.exec(raw);
  if (fmMatch) {
    const updated = insertIntoExistingBlock(fmMatch[1] as string, "devto", lines);
    if (updated !== null) {
      await writeFile(file, `---\n${updated}\n---\n${raw.slice(fmMatch[0].length)}`, "utf8");
      return;
    }
  }
  await writeFile(file, insertSyndicationBlock(raw, `  devto:\n${lines}`), "utf8");
}

/**
 * dev.to article body の sha256 prefix (16 hex chars) を返す。`syndication.devto.
 * contentHash` の SoT で、PUT idempotency gate に使う。
 *
 * 短縮 prefix にする理由: 19 記事 scale で 64-bit collision は事実上ゼロ、frontmatter
 * noise を抑える、git diff の視認性。
 *
 * @graph-connects none
 */
export function computeDevtoContentHash(article: DevtoArticleAttributes): string {
  return createHash("sha256").update(JSON.stringify(article)).digest("hex").slice(0, 16);
}

/**
 * source .md の frontmatter `syndication.devto.contentHash` を上書き/挿入する。既に
 * `devto:` block が存在していて、`id` / `slug` の下に `contentHash:` が有れば 1 行
 * 置換、無ければ block 末尾に新規行を挿入。
 *
 * `devto:` block が無いケースは {@link writebackDevtoToFile} の create 経路から
 * `devtoContentHash` 引数を渡して同時挿入する想定で、本関数は呼ばれない。
 *
 * @graph-connects none
 */
export async function writebackDevtoContentHashToFile(
  file: string,
  contentHash: string,
): Promise<void> {
  const raw = await readFile(file, "utf8");
  const fmMatch = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  if (!fmMatch) {
    throw new Error("frontmatter delimiter `---\\n...\\n---\\n` not found");
  }
  const fmContent = fmMatch[1] as string;
  const afterFm = raw.slice(fmMatch[0].length);
  const updatedFm = upsertDevtoContentHash(fmContent, contentHash);
  await writeFile(file, `---\n${updatedFm}\n---\n${afterFm}`, "utf8");
}

/**
 * frontmatter content (delimiter 抜きの中身) を受け取り、`syndication.devto`
 * block 内の `contentHash:` 行を upsert する。
 *
 * @graph-connects none
 */
export function upsertDevtoContentHash(fmContent: string, contentHash: string): string {
  const newLine = `    contentHash: "${contentHash}"`;
  // 既存 contentHash 行 → 値だけ書き換え
  if (/^ {4}contentHash:/m.test(fmContent)) {
    return fmContent.replace(/^ {4}contentHash:.*$/m, newLine);
  }
  // devto: block の最終 sub-key 直後に挿入。slug の行を anchor として末尾置換。
  const slugMatch = /^( {4}slug:.*)$/m.exec(fmContent);
  if (!slugMatch) {
    throw new Error("syndication.devto.slug line not found; cannot insert contentHash");
  }
  return fmContent.replace(/^( {4}slug:.*)$/m, `${slugMatch[1]}\n${newLine}`);
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
    // slug 不在 (= publishAt だけ予約済で未作成) の post は公開 URL を持たないので map しない。
    if (d?.slug) {
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
  /** source post の dir。writeback 時の `.ja.md` path を解決する。test では tmpdir を渡す。default: {@link POSTS_DIR}。 */
  postsDir?: string;
  /** `syndication.zenn.publishAt` 評価時刻。CLI 経路では loop 開始前に 1 回 fix し、
   *  全 post に同一 Date を渡すことで process 内で publishAt 境界をまたぐ race を防ぐ。
   *  未指定なら loop 内で 1 度 fix する。 */
  now?: Date;
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
  // publishAt 境界 race 防止のため、loop 開始前に 1 度だけ now を fix する
  const now = args.now ?? new Date();

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
      const srcFile = resolve(args.postsDir ?? POSTS_DIR, `${p.slug}.ja.md`);
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
      // per-post で frontmatter.emoji が指定されていれば、それを Zenn 記事カードの
      // emoji として使う。未指定なら syndicateForZenn 側の default 🤖。
      emoji: p.meta.emoji,
      now,
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
  /** source post の dir。writeback 時の `.en.md` path を解決する。test では tmpdir を渡す。default: {@link POSTS_DIR}。 */
  postsDir?: string;
  /** `syndication.devto.publishAt` 評価時刻。CLI 経路では loop 開始前に 1 回 fix し、
   *  全 post に同一 Date を渡すことで process 内で publishAt 境界をまたぐ race を防ぐ。
   *  未指定なら loop 内で 1 度 fix する。 */
  now?: Date;
}

/** dev.to 変換: 全 .en.md を API article attributes として JSON で書き出す + 任意で PUT publish。 */
export async function emitDevto(args: EmitDevtoArgs): Promise<void> {
  const resolver = buildDevtoResolver(args.posts);
  await mkdir(args.outDir, { recursive: true });
  // apiKey の有無 = publish mode の有無 と等価にする (publish mode で apiKey が無ければ
  // 直後の throw で gate)。以後の loop では `apiKey` truthy = "publish + key あり" を
  // 単独で narrow できる。
  const apiKey = args.publish ? (args.apiKey ?? process.env.DEV_TO_API_KEY) : undefined;
  if (args.publish && !apiKey) {
    throw new Error("--publish requires DEV_TO_API_KEY env");
  }
  // publishAt 境界 race 防止のため、loop 開始前に 1 度だけ now を fix する
  const now = args.now ?? new Date();

  for (const p of args.posts) {
    if (p.lang !== "en") continue;
    if (args.slug && p.slug !== args.slug) continue;
    const devto = p.meta.syndication.devto;
    const article = syndicateForDevto({
      meta: p.meta,
      body: p.body,
      slug: p.slug,
      resolver,
      canonicalHost: RYANTSUJI_DEV_BASE,
      coverImageUrl: p.meta.cover ? `${RYANTSUJI_DEV_BASE}${p.meta.cover}` : undefined,
      now,
    });

    const contentHash = computeDevtoContentHash(article);
    const srcFile = resolve(args.postsDir ?? POSTS_DIR, `${p.slug}.en.md`);

    // dev.to article id を解決する。id 不在 = 「devto block 自体が無い」or
    // 「publishAt だけ予約済で未作成」の両方を含む (schema で id を optional 化済)。
    let articleId: number;
    let justCreated = false;
    if (devto?.id === undefined) {
      if (!apiKey) {
        console.warn(`  [skip] ${p.slug}.en.md: no syndication.devto.id (dry-run)`);
        continue;
      }
      // publish mode で id が無い場合は POST で article 作成 → id + slug を frontmatter
      // に書き戻し (既存 publishAt は温存) → 以後の syndicate で update 経路に乗る。
      const created = await createDevtoArticle({ apiKey, article });
      articleId = created.id;
      justCreated = true;
      await writebackDevtoToFile(srcFile, created.id, created.slug, contentHash);
      console.log(
        `  [create] ${p.slug}.en.md: dev.to article created id=${created.id} slug=${created.slug}`,
      );
    } else {
      articleId = devto.id;
    }

    const outPath = resolve(args.outDir, `${p.slug}.json`);
    await writeFile(outPath, JSON.stringify({ id: articleId, article }, null, 2) + "\n", "utf8");
    console.log(`  devto: ${p.slug} → ${outPath}`);

    // POST 直後の state と PUT body は同一なので、create 経路を踏んだ post は PUT skip。
    // dev.to は 30 req / 30 sec の rate limit + `edited_at` 更新副作用が重なるため二度叩きを避ける。
    if (!apiKey || justCreated) continue;
    // contentHash idempotency gate: 直近 PUT で送った body の hash が変わってなければ skip。
    // dev.to PUT は body 同一でも `edited_at` を bump するため、毎 cron tick (15 分) で
    // 全 article が「今日更新」になる事故をここで止める。
    if (devto?.contentHash === contentHash) {
      console.log(`    publish: skip (contentHash unchanged)`);
      continue;
    }
    const result = await publishToDevto({ apiKey, articleId, article });
    await writebackDevtoContentHashToFile(srcFile, contentHash);
    console.log(`    publish: ${result.url} (contentHash=${contentHash})`);
  }
}
