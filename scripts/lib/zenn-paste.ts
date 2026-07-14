/*
 * Zenn コメント手貼り文面の pure ロジック層。
 *
 * `scripts/build-zenn-comment-paste.ts` (CLI glue) から切り出した、IO を持たない
 * 文面組立て / parse / HTML render の関数群。scaffold .md は AI (skill 実行者) が
 * `{{TRANSLATE:...}}` を翻訳で置換して往復するため、`buildScaffoldMarkdown` →
 * (翻訳) → `parseScaffoldMarkdown` の round-trip が壊れないことを sibling test で守る。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business Zenn 手貼り文面の pure ロジック (コメント markdown 組立て / scaffold .md の build・parse round-trip / コピーボタン付きダッシュボード HTML render)。CLI glue から分離してテスト可能にする
 * @graph-connects devto [reads_from] scripts/lib/devto-threads の FlatComment を文面の入力に取る
 */

import type { FlatComment } from "./devto-threads.js";

/** 翻訳が済んでいない目印。render 側で「未翻訳」警告に使う。 */
export const TRANSLATE_MARK = "{{TRANSLATE:";

/** 貼り付け 1 単位 (= 1 dev.to コメント = 1 Zenn コメント)。 */
export interface PasteComment {
  /** 所属スレッドの index (会話の区切り表示に使う)。 */
  threadIndex: number;
  /** そのまま Zenn に貼る markdown (本文は翻訳前だと {{TRANSLATE:...}} を含む)。 */
  markdown: string;
}

/** scaffold .md の先頭メタ + コメント群。render が記事単位で並べるのに使う。 */
export interface ArticleScaffold {
  key: string;
  title: string;
  url: string;
  comments: PasteComment[];
}

/** 1 コメントを、そのまま Zenn に貼れる自己完結した markdown にする。本文は {{TRANSLATE:...}} で囲む。 */
export function renderCommentMarkdown(c: FlatComment): string {
  const who = c.isOwner ? "**自分の返信**" : `**[${c.authorName}](${c.authorProfileUrl})** さん`;
  const attribution = `${who}（via dev.to · [原文](${c.sourceUrl})）:`;
  return [attribution, "", "{{TRANSLATE:", c.body, "}}"].join("\n");
}

/** dev.to の本人関与スレッド群を、貼り付け 1 単位ずつの PasteComment[] に展開する。 */
export function toPasteComments(groups: { timeline: FlatComment[] }[]): PasteComment[] {
  const out: PasteComment[] = [];
  groups.forEach((g, threadIndex) => {
    for (const c of g.timeline) {
      out.push({ threadIndex, markdown: renderCommentMarkdown(c) });
    }
  });
  return out;
}

/** scaffold .md を組み立てる (メタ header + `<!--c t=N-->` 区切りのコメント群)。 */
export function buildScaffoldMarkdown(
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
export function parseScaffoldMarkdown(md: string): ArticleScaffold | null {
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
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 記事単位で並ぶダッシュボード HTML を組み立てる。 */
export function renderDashboardHtml(articles: ArticleScaffold[]): string {
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
