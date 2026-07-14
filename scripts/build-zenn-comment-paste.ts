/*
 * Zenn のコメント欄へ手貼りする文面を生成する 2 フェーズ CLI (glue 層)。
 *
 * 背景: Zenn には書き込み API が無く、コメントは手動投稿しかできない。一方 dev.to の英語記事には
 * 質の高い議論が付く。そこで「著者名 / dev.to プロフィール / 原文 deep link / via dev.to」という
 * 定型部分を機械的に組み立て、**本文の翻訳だけを AI (skill 実行者) が埋める** 分業にする。
 * ryantsuji.dev 側は原文ママで自動 upsert (import-devto-comments.ts)、Zenn 側は JP 読者向けに翻訳して
 * 手貼り、という 2 経路。取得・選別は scripts/lib/devto-threads.ts、文面組立て / parse / HTML render
 * の pure ロジックは scripts/lib/zenn-paste.ts に分離し、本ファイルは argv / fs / fetch の glue のみ。
 *
 * 貼り付け単位は **1 dev.to コメント = 1 Zenn コメント (メッセージ単位)**。スレッドをまとめて 1 通に
 * すると読みづらく、運用上もコメントが付くたびにリアルタイムで貼りたいので、発言 1 件ずつを独立した
 * 貼り付けカードにする (ryantsuji.dev の 1:1 と同じ粒度)。会話の順序は thread ごとに保つ。
 *
 * フェーズ:
 *   1. scaffold: `<slug>` / `--a-id <id>` で dev.to から取得し、本人が絡んだスレッドの各コメントを
 *      `.zenn-paste/<key>.md` に 1 ブロックずつ書き出す。本文は `{{TRANSLATE:...}}` で囲む。
 *      → skill がこの .md の `{{TRANSLATE:...}}` を自然な日本語訳に置換する。
 *   2. render: `--render` で `.zenn-paste/*.md` を全部読み、記事単位でコメントが並ぶダッシュボード
 *      `.zenn-paste/index.html` を生成する。各コメントに「コピー」ボタンと「完了」チェック
 *      (localStorage 永続) が付く。`.zenn-paste/` は gitignore 済み。
 *
 * 使い方:
 *   pnpm tsx scripts/build-zenn-comment-paste.ts <slug>       # content の <slug>.en.md の devto id から
 *   pnpm tsx scripts/build-zenn-comment-paste.ts --a-id <id>  # dev.to article id を直接指定
 *   pnpm tsx scripts/build-zenn-comment-paste.ts --render     # 翻訳済み .md を HTML ダッシュボードに
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business Zenn コメント欄へ手貼りする文面の 2 フェーズ生成 CLI (glue)。scaffold で本人関与スレッドの各発言を .md に書き出し (定型は自動組立・本文は AI 翻訳枠)、render で記事単位に並ぶ HTML ダッシュボードを gitignore 下に生成。pure ロジックは scripts/lib/zenn-paste.ts に分離
 * @graph-connects content [reads_from] content/posts の <slug>.en.md frontmatter から devto article id を引く
 * @graph-connects devto [calls] scripts/lib/devto-threads 経由でコメントツリー / 記事メタを取得
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  fetchArticleMeta,
  fetchDevtoComments,
  groupOwnerThreads,
  POSTS_DIR,
  readPostDevtoIds,
  REPO_ROOT,
} from "./lib/devto-threads.js";
import {
  buildScaffoldMarkdown,
  parseScaffoldMarkdown,
  renderDashboardHtml,
  toPasteComments,
  TRANSLATE_MARK,
  type ArticleScaffold,
} from "./lib/zenn-paste.js";

/** 生成物の出力先 (gitignore 済み)。 */
const OUT_DIR = resolve(REPO_ROOT, ".zenn-paste");

/** CLI 引数を解釈して dev.to article id を決める (scaffold 用)。 */
async function resolveArticleId(argv: string[]): Promise<{ devtoId: number; key: string }> {
  const aIdFlag = argv.indexOf("--a-id");
  if (aIdFlag !== -1) {
    const raw = argv[aIdFlag + 1];
    const devtoId = Number(raw);
    if (!Number.isInteger(devtoId) || devtoId <= 0) {
      throw new Error(`--a-id には正の整数を渡してください (got: ${String(raw)})`);
    }
    return { devtoId, key: `aid-${String(devtoId)}` };
  }
  const slug = argv[0];
  if (!slug || slug.startsWith("--")) {
    throw new Error(
      "slug を渡してください: `pnpm tsx scripts/build-zenn-comment-paste.ts <slug>` " +
        "または `--a-id <devto article id>` / `--render`",
    );
  }
  if (!existsSync(POSTS_DIR)) {
    throw new Error(
      `posts dir not found: ${POSTS_DIR}. \`git submodule update --init\` で content を取得してください。`,
    );
  }
  const targets = await readPostDevtoIds(slug);
  const hit = targets.find((t) => t.slug === slug);
  if (!hit) {
    throw new Error(
      `slug=${slug} の <slug>.en.md に syndication.devto.id が見つかりません。` +
        " 記事がまだ dev.to に syndicate されていない可能性があります。",
    );
  }
  return { devtoId: hit.devtoId, key: slug };
}

/** scaffold フェーズ: dev.to から取得して .zenn-paste/<key>.md を書く。 */
async function runScaffold(argv: string[]): Promise<void> {
  const { devtoId, key } = await resolveArticleId(argv);
  const [tree, meta] = await Promise.all([fetchDevtoComments(devtoId), fetchArticleMeta(devtoId)]);
  const groups = groupOwnerThreads(tree, meta.url);
  const comments = toPasteComments(groups);
  if (comments.length === 0) {
    console.log(`[zenn] ${key}: 本人が絡んだスレッドがありません (貼り付け対象なし)`);
    return;
  }
  const md = buildScaffoldMarkdown({ key, title: meta.title, url: meta.url }, comments);
  await mkdir(OUT_DIR, { recursive: true });
  const outPath = resolve(OUT_DIR, `${key}.md`);
  await writeFile(outPath, md, "utf8");
  console.log(`[zenn] ${key}: ${String(comments.length)} comment(s) → ${outPath}`);
  console.log("次: この .md の {{TRANSLATE:...}} を日本語訳に置換 → `--render` で HTML 化。");
}

/** render フェーズ: 翻訳済み .zenn-paste/*.md を index.html に集約する。 */
async function runRender(): Promise<void> {
  if (!existsSync(OUT_DIR)) {
    throw new Error(
      `${OUT_DIR} がありません。先に scaffold (<slug> / --a-id) を実行してください。`,
    );
  }
  const files = (await readdir(OUT_DIR)).filter((f) => f.endsWith(".md")).sort();
  const articles: ArticleScaffold[] = [];
  for (const f of files) {
    const md = await readFile(resolve(OUT_DIR, f), "utf8");
    const parsed = parseScaffoldMarkdown(md);
    if (parsed && parsed.comments.length > 0) articles.push(parsed);
  }
  if (articles.length === 0) {
    console.log(`[zenn] ${OUT_DIR} に対象 .md がありません。`);
    return;
  }
  const html = renderDashboardHtml(articles);
  const outPath = resolve(OUT_DIR, "index.html");
  await writeFile(outPath, html, "utf8");
  const total = articles.reduce((n, a) => n + a.comments.length, 0);
  const untranslated = articles.reduce(
    (n, a) => n + a.comments.filter((c) => c.markdown.includes(TRANSLATE_MARK)).length,
    0,
  );
  console.log(`[zenn] ${String(articles.length)} 記事 / ${String(total)} コメント → ${outPath}`);
  if (untranslated > 0) {
    console.log(
      `[zenn] ⚠ ${String(untranslated)} 件がまだ {{TRANSLATE:...}} のままです (翻訳してから再 render)。`,
    );
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--render")) {
    await runRender();
    return;
  }
  await runScaffold(argv);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
