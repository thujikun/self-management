/*
 * generate-covers logic — content/posts/*.{ja,en}.md から og:image PNG を生成し、
 * `apps/ryantsuji-dev/web/public/posts/<slug>.<lang>.cover.png` に書き出す。
 * 同時に該当 markdown の frontmatter.cover を該当 path に自動更新する。
 *
 * font 取得は I/O なので本 module 内に隔離 (`loadOgFonts`)。jsdelivr 経由で
 * fontsource の WOFF を 1 回だけ download → `.cache/og-fonts/` に保存 → 次回以降は
 * disk から読む。CI でも repo を clone した直後の cold cache から動く。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business og:image 生成 logic。全 post を走査し JP/EN 共通の brand 横長テンプレートで PNG を生成、public/posts/ に書き出して frontmatter.cover も書き戻す。font は cdn からの 1 回 download を local cache に持つ
 * @graph-connects content [reads_from] content/posts の全 .{ja,en}.md を入力、frontmatter.cover を書き戻す
 * @graph-connects og-image [calls] @self/og-image の renderOgImage で satori+resvg を回す
 */

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { coverPublicPath, renderOgImage, type OgFonts } from "@self/og-image";

import { POSTS_DIR, parseFileName, readAllPosts, type ParsedPost } from "./syndicate.js";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPTS_DIR, "..");

export const PUBLIC_POSTS_DIR = resolve(REPO_ROOT, "apps/ryantsuji-dev/web/public/posts");
export const FONT_CACHE_DIR = resolve(REPO_ROOT, ".cache/og-fonts");

/**
 * jsdelivr 経由で fontsource の WOFF を取得。固定 major version を URL に埋め、
 * 同 patch は同 hash になる前提で local cache を再利用する。
 *
 * - JP serif: Noto Serif JP 700 (japanese subset = JP + ASCII 両方カバー)
 * - latin sans: Inter 500 (footer / EN タイトルで両 lang 共通)
 *
 * `@fontsource/...@5/files/...` 形式は 5.x 系の最新 patch に追従する。stable な
 * font なので revision 固定はせず major のみ縛る (= 必要なら更新は npm view 経由)。
 */
const FONT_SOURCES = {
  serif:
    "https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-jp@5/files/noto-serif-jp-japanese-700-normal.woff",
  sans: "https://cdn.jsdelivr.net/npm/@fontsource/inter@5/files/inter-latin-500-normal.woff",
} as const;

async function fetchFont(url: string, cachePath: string): Promise<ArrayBuffer> {
  try {
    await stat(cachePath);
    const buf = await readFile(cachePath);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  } catch {
    // cache miss → fetch
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`font fetch failed (${res.status}): ${url}`);
  }
  const ab = await res.arrayBuffer();
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, Buffer.from(ab));
  return ab;
}

/**
 * og:image 用の font set を読み込む。cache miss 時のみ network。
 */
export async function loadOgFonts(): Promise<OgFonts> {
  const serif = await fetchFont(
    FONT_SOURCES.serif,
    resolve(FONT_CACHE_DIR, "noto-serif-jp-japanese-700.woff"),
  );
  const sans = await fetchFont(FONT_SOURCES.sans, resolve(FONT_CACHE_DIR, "inter-latin-500.woff"));
  return { serif, sans };
}

/**
 * og:image の出力先 path (public/posts/ 配下の絶対 path)。site-relative path
 * (`/posts/<slug>.<lang>.cover.png`) の SoT は `@self/og-image` の `coverPublicPath`
 * 側で、本 helper は public dir 配下に absolute 解決した filesystem path を返す。
 */
export function coverFilePath(slug: string, lang: "ja" | "en"): string {
  return resolve(PUBLIC_POSTS_DIR, `${slug}.${lang}.cover.png`);
}

// `coverPublicPath` は `@self/og-image` で定義済み。test と consumer の後方互換のため
// 同名で再 export する (generator と consumer が同 helper を経由していることを保証
// する double-source-of-truth 防止)。
export { coverPublicPath };

/**
 * markdown ファイルの frontmatter に `cover: <path>` を surgical に注入する。
 *
 * gray-matter の `matter.stringify` を使うと YAML 全体を再 serialize して quote 形式
 * (e.g. `"foo"` ↔ `foo` ↔ `'foo'`) や複数行 string の折り畳みが変わってしまうため、
 * 既存 `cover:` 行を正規表現で置換、無ければ frontmatter 末尾に append する戦略。
 * cover 以外の field は byte-for-byte で温存される。
 */
export function injectCoverLine(
  source: string,
  coverPath: string,
): { next: string; updated: boolean } {
  // 先頭の YAML frontmatter block を捕捉。`---\n<body>\n---\n` を期待。
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(source);
  if (!m) {
    throw new Error("frontmatter block not found (expected leading `---` fence)");
  }
  const header = m[0];
  const body = m[1];

  const coverLine = `cover: ${coverPath}`;
  // 既存 `cover: ...` を捕捉 (top-level のみ、indent 0)
  const existing = /^cover:\s*([^\n]*)$/m;
  if (existing.test(body)) {
    const currentMatch = existing.exec(body);
    const current = currentMatch ? currentMatch[1].trim() : "";
    if (current === coverPath) {
      return { next: source, updated: false };
    }
    const nextBody = body.replace(existing, coverLine);
    return {
      next: source.replace(header, `---\n${nextBody}\n---\n`),
      updated: true,
    };
  }

  // 末尾 append。trailing newline 揃え。
  const nextBody = `${body}\n${coverLine}`;
  return {
    next: source.replace(header, `---\n${nextBody}\n---\n`),
    updated: true,
  };
}

/**
 * markdown ファイルの frontmatter.cover を書き戻す。`injectCoverLine` で
 * surgical に編集してから writeFile。同値なら disk write も skip する。
 */
export async function writeCoverIntoFrontmatter(
  filePath: string,
  coverPath: string,
): Promise<{ updated: boolean }> {
  const raw = await readFile(filePath, "utf8");
  const { next, updated } = injectCoverLine(raw, coverPath);
  if (!updated) return { updated: false };
  await writeFile(filePath, next, "utf8");
  return { updated: true };
}

/** {@link generateAllCovers} の引数。 */
export interface GenerateArgs {
  posts: ParsedPost[];
  fonts: OgFonts;
  /** 指定したら一致する slug の post のみ処理。 */
  slug?: string;
  /** true なら markdown の frontmatter.cover も書き戻す。 */
  writeFrontmatter: boolean;
}

/** 1 post 1 result。 */
export interface CoverResult {
  slug: string;
  lang: "ja" | "en";
  pngPath: string;
  publicPath: string;
  /** markdown を書き戻したか (frontmatter.cover を実際に変更した時のみ true)。 */
  frontmatterUpdated: boolean;
}

/**
 * post 1 件分の og:image を生成 + (任意で) frontmatter.cover を書き戻す。
 */
export async function generateCoverForPost(
  post: ParsedPost,
  fonts: OgFonts,
  options: { writeFrontmatter: boolean },
): Promise<CoverResult> {
  const png = await renderOgImage({
    lang: post.lang,
    title: post.meta.title,
    fonts,
  });
  const pngPath = coverFilePath(post.slug, post.lang);
  await mkdir(dirname(pngPath), { recursive: true });
  await writeFile(pngPath, png);

  const publicPath = coverPublicPath(post.slug, post.lang);
  let frontmatterUpdated = false;
  if (options.writeFrontmatter) {
    const mdPath = resolve(POSTS_DIR, `${post.slug}.${post.lang}.md`);
    const r = await writeCoverIntoFrontmatter(mdPath, publicPath);
    frontmatterUpdated = r.updated;
  }
  return {
    slug: post.slug,
    lang: post.lang,
    pngPath,
    publicPath,
    frontmatterUpdated,
  };
}

/**
 * 全 post (または `slug` filter) の og:image を順次生成する。
 *
 * 並列化していない理由: satori + resvg は CPU bound、本数も最大 16 なので素直に
 * for-await で逐次実行する方が log の出力が綺麗で debug しやすい。CI 時間にも
 * 影響しない (1 枚 < 200ms オーダー)。
 */
export async function generateAllCovers(args: GenerateArgs): Promise<CoverResult[]> {
  const results: CoverResult[] = [];
  for (const p of args.posts) {
    if (args.slug && p.slug !== args.slug) continue;
    // `_` 始まりは test fixture (`_minimal-fixture.en.md` 等) なので og:image は出さない
    if (!args.slug && p.slug.startsWith("_")) continue;
    const r = await generateCoverForPost(p, args.fonts, {
      writeFrontmatter: args.writeFrontmatter,
    });
    results.push(r);
  }
  return results;
}

export { POSTS_DIR, parseFileName, readAllPosts };
