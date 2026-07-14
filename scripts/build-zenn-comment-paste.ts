/*
 * Zenn のコメント欄へ手貼りする文面を生成する 2 フェーズ CLI。
 *
 * 背景: Zenn には書き込み API が無く、コメントは手動投稿しかできない。一方 dev.to の英語記事には
 * 質の高い議論が付く。そこで「著者名 / dev.to プロフィール / 原文 deep link / via dev.to」という
 * 定型部分を本 script が機械的に組み立て、**本文の翻訳だけを AI (skill 実行者) が埋める** 分業にする。
 * ryantsuji.dev 側は原文ママで自動 upsert (import-devto-comments.ts)、Zenn 側は JP 読者向けに翻訳して
 * 手貼り、という 2 経路。取得・選別ロジックは両者で共有 (scripts/lib/devto-threads.ts)。
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
 * @graph-business Zenn コメント欄へ手貼りする文面の 2 フェーズ生成 CLI。貼り付け単位は 1 dev.to コメント = 1 Zenn コメント。scaffold で本人関与スレッドの各発言を .md に書き出し (定型は自動組立・本文は AI 翻訳枠)、render で記事単位に並ぶ HTML ダッシュボード (コメント毎のコピーボタン + 完了チェック永続) を gitignore 下に生成する
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
  type FlatComment,
} from "./lib/devto-threads.js";

/** 生成物の出力先 (gitignore 済み)。 */
const OUT_DIR = resolve(REPO_ROOT, ".zenn-paste");

/** 翻訳が済んでいない目印。render 側で「未翻訳」警告に使う。 */
const TRANSLATE_MARK = "{{TRANSLATE:";

/** 貼り付け 1 単位 (= 1 dev.to コメント = 1 Zenn コメント)。 */
interface PasteComment {
  /** 所属スレッドの index (会話の区切り表示に使う)。 */
  threadIndex: number;
  /** そのまま Zenn に貼る markdown (本文は翻訳前だと {{TRANSLATE:...}} を含む)。 */
  markdown: string;
}

/** scaffold .md の先頭メタ + コメント群。render が記事単位で並べるのに使う。 */
interface ArticleScaffold {
  key: string;
  title: string;
  url: string;
  comments: PasteComment[];
}

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

/** 1 コメントを、そのまま Zenn に貼れる自己完結した markdown にする。本文は {{TRANSLATE:...}} で囲む。 */
function renderCommentMarkdown(c: FlatComment): string {
  const who = c.isOwner ? "**自分の返信**" : `**[${c.authorName}](${c.authorProfileUrl})** さん`;
  const attribution = `${who}（via dev.to · [原文](${c.sourceUrl})）:`;
  return [attribution, "", "{{TRANSLATE:", c.body, "}}"].join("\n");
}

/** dev.to の本人関与スレッド群を、貼り付け 1 単位ずつの PasteComment[] に展開する。 */
function toPasteComments(groups: { timeline: FlatComment[] }[]): PasteComment[] {
  const out: PasteComment[] = [];
  groups.forEach((g, threadIndex) => {
    for (const c of g.timeline) {
      out.push({ threadIndex, markdown: renderCommentMarkdown(c) });
    }
  });
  return out;
}

/** scaffold .md を組み立てる (メタ header + `<!--c t=N-->` 区切りのコメント群)。 */
function buildScaffoldMarkdown(
  meta: { key: string; title: string; url: string },
  comments: PasteComment[],
): string {
  const head = [
    "<!--zenn-paste",
    `key: ${meta.key}`,
    `title: ${meta.title}`,
    `url: ${meta.url}`,
    "-->",
    "",
    `<!-- ${meta.title} — ${String(comments.length)} 件のコメント。1 件 = Zenn の 1 コメント。`,
    "     {{TRANSLATE:...}} を自然な日本語訳に置換してから `--render` で HTML 化してください。",
    "     定型 (著者名 / リンク / via dev.to) は変えないこと。 -->",
  ].join("\n");
  const blocks = comments.map((c) => `<!--c t=${String(c.threadIndex)}-->\n${c.markdown}`);
  return [head, "", blocks.join("\n\n"), ""].join("\n");
}

/** scaffold .md を parse して記事メタ + コメント群に戻す (render 用)。 */
function parseScaffoldMarkdown(md: string): ArticleScaffold | null {
  const metaMatch = md.match(/<!--zenn-paste\s*([\s\S]*?)-->/);
  if (!metaMatch) return null;
  const meta: Record<string, string> = {};
  for (const line of metaMatch[1].split("\n")) {
    const m = line.match(/^\s*(key|title|url):\s*(.+?)\s*$/);
    if (m) meta[m[1]] = m[2];
  }
  if (!meta.key || !meta.url) return null;
  const afterMeta = md.slice((metaMatch.index ?? 0) + metaMatch[0].length);
  const comments: PasteComment[] = [];
  const re = /<!--c t=(\d+)-->\s*([\s\S]*?)(?=\n*<!--c t=\d+-->|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(afterMeta)) !== null) {
    const markdown = m[2].trim();
    if (markdown.length > 0) {
      comments.push({ threadIndex: Number(m[1]), markdown });
    }
  }
  return { key: meta.key, title: meta.title ?? meta.key, url: meta.url, comments };
}

/** HTML エスケープ (textarea / 属性へ埋め込む本文用)。 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 記事単位で並ぶダッシュボード HTML を組み立てる。 */
function renderDashboardHtml(articles: ArticleScaffold[]): string {
  const sections = articles.map((a) => renderArticleSection(a)).join("\n");
  const total = articles.reduce((n, a) => n + a.comments.length, 0);
  return [
    "<!doctype html>",
    '<html lang="ja"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>Zenn コメント手貼りダッシュボード</title>",
    `<style>${DASHBOARD_CSS}</style>`,
    "</head><body>",
    `<h1>Zenn コメント手貼り <span class="muted">(${String(articles.length)} 記事 / ${String(total)} コメント)</span></h1>`,
    '<p class="muted">1 カード = Zenn の 1 コメント。「コピー」で markdown をクリップボードへ → 貼り付け → 「完了」にチェック (ブラウザに保存)。</p>',
    sections,
    `<script>${DASHBOARD_JS}</script>`,
    "</body></html>",
    "",
  ].join("\n");
}

/** 1 記事分のセクション (見出し + 進捗 + スレッド区切り + コメントカード群)。 */
function renderArticleSection(a: ArticleScaffold): string {
  const threadCount = new Set(a.comments.map((c) => c.threadIndex)).size;
  const parts: string[] = [
    `<section class="article" data-key="${escapeHtml(a.key)}">`,
    `<h2><a href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(a.title)}</a>`,
    ` <span class="progress" data-key="${escapeHtml(a.key)}"></span></h2>`,
  ];
  let prevThread = -1;
  a.comments.forEach((c, i) => {
    // 複数スレッドある記事だけ、スレッドの変わり目に区切りを出す。
    if (threadCount > 1 && c.threadIndex !== prevThread) {
      parts.push(`<div class="thread-sep">スレッド ${String(c.threadIndex + 1)}</div>`);
      prevThread = c.threadIndex;
    }
    parts.push(renderCard(a.key, i, c.markdown));
  });
  parts.push("</section>");
  return parts.join("\n");
}

/** 1 コメントカード (完了チェック + markdown textarea + コピーボタン)。 */
function renderCard(key: string, idx: number, body: string): string {
  const id = `${key}#${String(idx)}`;
  const untranslated = body.includes(TRANSLATE_MARK);
  const warn = untranslated ? '<span class="warn">⚠ 未翻訳</span>' : "";
  return [
    `<div class="card" data-id="${escapeHtml(id)}">`,
    `<div class="card-head">`,
    `<label class="done"><input type="checkbox" class="done-cb" data-id="${escapeHtml(id)}"> 完了</label>`,
    `<span class="cid">#${String(idx + 1)}</span>${warn}`,
    `<button type="button" class="copy" data-id="${escapeHtml(id)}">📋 コピー</button>`,
    `</div>`,
    `<textarea class="md" spellcheck="false" data-id="${escapeHtml(id)}">${escapeHtml(body)}</textarea>`,
    `</div>`,
  ].join("\n");
}

const DASHBOARD_CSS = `
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:900px;margin:0 auto;padding:24px}
h1{font-size:20px;margin:0 0 4px}
.muted{color:#888;font-weight:400;font-size:13px}
.article{margin:28px 0;border-top:1px solid #8883;padding-top:12px}
.article h2{font-size:16px;margin:0 0 12px}
.article h2 a{color:inherit;text-decoration:none}
.article h2 a:hover{text-decoration:underline}
.progress{font-size:12px;color:#888;font-weight:400}
.thread-sep{font-size:12px;color:#888;margin:16px 0 6px;padding-left:2px;border-left:3px solid #8885;padding:2px 8px}
.card{border:1px solid #8884;border-radius:8px;padding:10px 12px;margin:10px 0;transition:opacity .15s}
.card.done{opacity:.45}
.card-head{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.done{font-size:13px;cursor:pointer;user-select:none}
.cid{font-size:12px;color:#888}
.warn{font-size:12px;color:#c60;font-weight:600}
.copy{margin-left:auto;font-size:13px;padding:4px 12px;border:1px solid #8886;border-radius:6px;background:transparent;cursor:pointer}
.copy:hover{background:#8882}
.copy.copied{border-color:#2a2;color:#2a2}
textarea.md{width:100%;min-height:120px;font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;padding:10px;border:1px solid #8884;border-radius:6px;background:#8881;resize:vertical}
`;

const DASHBOARD_JS = `
(function(){
  var PREFIX='zenn-paste-done:';
  function key(id){return PREFIX+id}
  function refresh(sectionKey){
    var cbs=document.querySelectorAll('.done-cb[data-id^="'+CSS.escape(sectionKey)+'#"]');
    var done=0;cbs.forEach(function(cb){if(cb.checked)done++});
    var p=document.querySelector('.progress[data-key="'+CSS.escape(sectionKey)+'"]');
    if(p)p.textContent=done+'/'+cbs.length+' 完了';
  }
  document.querySelectorAll('.done-cb').forEach(function(cb){
    var id=cb.getAttribute('data-id');
    cb.checked=localStorage.getItem(key(id))==='1';
    var card=document.querySelector('.card[data-id="'+CSS.escape(id)+'"]');
    if(card&&cb.checked)card.classList.add('done');
    cb.addEventListener('change',function(){
      localStorage.setItem(key(id),cb.checked?'1':'0');
      if(card)card.classList.toggle('done',cb.checked);
      refresh(id.split('#')[0]);
    });
  });
  document.querySelectorAll('.copy').forEach(function(btn){
    btn.addEventListener('click',function(){
      var id=btn.getAttribute('data-id');
      var ta=document.querySelector('textarea.md[data-id="'+CSS.escape(id)+'"]');
      if(!ta)return;
      navigator.clipboard.writeText(ta.value).then(function(){
        btn.classList.add('copied');btn.textContent='✓ コピー済み';
        setTimeout(function(){btn.classList.remove('copied');btn.textContent='📋 コピー'},1500);
      });
    });
  });
  document.querySelectorAll('.progress').forEach(function(p){refresh(p.getAttribute('data-key'))});
})();
`;

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
