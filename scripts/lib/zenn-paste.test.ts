/**
 * `zenn-paste.ts` (Zenn 手貼り文面の pure ロジック) の test。
 *
 * 中核は buildScaffoldMarkdown → (AI 翻訳) → parseScaffoldMarkdown の round-trip。
 * 翻訳者 (AI) が {{TRANSLATE:...}} を置換したり空行を増減させても、コメントの
 * 件数 / thread 対応 / 本文が壊れず parse できることを固定する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business Zenn 手貼り文面組立ての回帰 test。scaffold .md の build → 翻訳編集 → parse round-trip と attribution 定型 (著者名 / via dev.to / 原文リンク)、ダッシュボード HTML の shape を凍結する
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import type { FlatComment } from "./devto-threads.js";
import {
  buildScaffoldMarkdown,
  escapeHtml,
  parseScaffoldMarkdown,
  renderCommentMarkdown,
  renderDashboardHtml,
  toPasteComments,
} from "./zenn-paste.js";

function flat(overrides: Partial<FlatComment> = {}): FlatComment {
  return {
    sourceCommentId: "abc",
    authorName: "Vini",
    authorUsername: "vinimabreu",
    authorProfileUrl: "https://dev.to/vinimabreu",
    sourceUrl: "https://dev.to/ryantsuji/post/comments/#comment-abc",
    body: "great point about threat models",
    createdAt: new Date("2026-05-01T00:00:00Z"),
    parentSourceId: null,
    isOwner: false,
    ...overrides,
  };
}

const META = { key: "my-post", title: "My Post", url: "https://dev.to/ryantsuji/my-post" };

describe("renderCommentMarkdown", () => {
  it("他者コメントは著者リンク + via dev.to + 原文リンクの定型で囲む", () => {
    expect(renderCommentMarkdown(flat())).toMatchInlineSnapshot(`
      "**[Vini](https://dev.to/vinimabreu)** さん（via dev.to · [原文](https://dev.to/ryantsuji/post/comments/#comment-abc)）:

      {{TRANSLATE:
      great point about threat models
      }}"
    `);
  });

  it("本人の返信は「自分の返信」表記になる", () => {
    expect(renderCommentMarkdown(flat({ isOwner: true, body: "thanks!" }))).toMatchInlineSnapshot(`
      "**自分の返信**（via dev.to · [原文](https://dev.to/ryantsuji/post/comments/#comment-abc)）:

      {{TRANSLATE:
      thanks!
      }}"
    `);
  });
});

describe("toPasteComments", () => {
  it("thread ごとに threadIndex を振って 1 コメント 1 単位に展開する", () => {
    const groups = [
      { timeline: [flat({ sourceCommentId: "a1" }), flat({ sourceCommentId: "a2" })] },
      { timeline: [flat({ sourceCommentId: "b1" })] },
    ];
    expect(toPasteComments(groups).map((p) => p.threadIndex)).toStrictEqual([0, 0, 1]);
  });
});

describe("buildScaffoldMarkdown → parseScaffoldMarkdown round-trip", () => {
  it("メタ + コメント (threadIndex / markdown) が往復で保存される", () => {
    const comments = toPasteComments([
      {
        timeline: [
          flat({ sourceCommentId: "a1" }),
          flat({ sourceCommentId: "a2", isOwner: true, body: "my reply" }),
        ],
      },
      { timeline: [flat({ sourceCommentId: "b1", body: "second thread" })] },
    ]);
    const md = buildScaffoldMarkdown(META, comments);
    expect(parseScaffoldMarkdown(md)).toStrictEqual({
      key: META.key,
      title: META.title,
      url: META.url,
      comments,
    });
  });

  it("翻訳で {{TRANSLATE:...}} が置換され空行が増えても件数と本文が壊れない", () => {
    const comments = toPasteComments([{ timeline: [flat(), flat({ sourceCommentId: "x2" })] }]);
    const translated = buildScaffoldMarkdown(META, comments)
      .replace(/\{\{TRANSLATE:\n[\s\S]*?\n\}\}/g, "脅威モデルについて素晴らしい指摘です。")
      // 翻訳者がコメント区切りの前後に空行を足すケース
      .replace(/<!--c t=(\d+)-->/g, "\n\n<!--c t=$1-->\n\n");
    const parsed = parseScaffoldMarkdown(translated);
    expect(parsed?.comments.map((c) => c.markdown)).toStrictEqual([
      "**[Vini](https://dev.to/vinimabreu)** さん（via dev.to · [原文](https://dev.to/ryantsuji/post/comments/#comment-abc)）:\n\n脅威モデルについて素晴らしい指摘です。",
      "**[Vini](https://dev.to/vinimabreu)** さん（via dev.to · [原文](https://dev.to/ryantsuji/post/comments/#comment-abc)）:\n\n脅威モデルについて素晴らしい指摘です。",
    ]);
    expect(parsed?.comments.map((c) => c.threadIndex)).toStrictEqual([0, 0]);
  });

  it("メタ header が無い .md は null", () => {
    expect(parseScaffoldMarkdown("# ただの markdown")).toBeNull();
  });

  it("key / url が欠けたメタは null", () => {
    expect(parseScaffoldMarkdown("<!--zenn-paste\ntitle: T\n-->")).toBeNull();
    expect(parseScaffoldMarkdown("<!--zenn-paste\nkey: k\ntitle: T\n-->")).toBeNull();
  });

  it("空のコメント block は落とす", () => {
    const md = [
      "<!--zenn-paste",
      "key: k",
      "url: https://x",
      "-->",
      "",
      "<!--c t=0-->",
      "",
      "<!--c t=1-->",
      "body",
    ].join("\n");
    expect(parseScaffoldMarkdown(md)?.comments).toStrictEqual([
      { threadIndex: 1, markdown: "body" },
    ]);
  });
});

describe("escapeHtml", () => {
  it('& < > " を entity 化する', () => {
    expect(escapeHtml('<a href="x">A & B</a>')).toBe(
      "&lt;a href=&quot;x&quot;&gt;A &amp; B&lt;/a&gt;",
    );
  });
});

describe("renderDashboardHtml", () => {
  it("記事 section / thread 区切り / 未翻訳 warn / コピーボタンを含む HTML を組む", () => {
    const article = {
      key: "my-post",
      title: "My <Post>",
      url: "https://dev.to/ryantsuji/my-post",
      comments: [
        { threadIndex: 0, markdown: "{{TRANSLATE:\nuntranslated\n}}" },
        { threadIndex: 1, markdown: "翻訳済み本文" },
      ],
    };
    expect(renderDashboardHtml([article])).toMatchInlineSnapshot(`
      "<!doctype html>
      <html lang="ja"><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Zenn コメント手貼りダッシュボード</title>
      <style>
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
      </style>
      </head><body>
      <h1>Zenn コメント手貼り <span class="muted">(1 記事 / 2 コメント)</span></h1>
      <p class="muted">1 カード = Zenn の 1 コメント。「コピー」で markdown をクリップボードへ → 貼り付け → 「完了」にチェック (ブラウザに保存)。</p>
      <section class="article" data-key="my-post">
      <h2><a href="https://dev.to/ryantsuji/my-post" target="_blank" rel="noopener noreferrer">My &lt;Post&gt;</a>
       <span class="progress" data-key="my-post"></span></h2>
      <div class="thread-sep">スレッド 1</div>
      <div class="card" data-id="my-post#0">
      <div class="card-head">
      <label class="done"><input type="checkbox" class="done-cb" data-id="my-post#0"> 完了</label>
      <span class="cid">#1</span><span class="warn">⚠ 未翻訳</span>
      <button type="button" class="copy" data-id="my-post#0">📋 コピー</button>
      </div>
      <textarea class="md" spellcheck="false" data-id="my-post#0">{{TRANSLATE:
      untranslated
      }}</textarea>
      </div>
      <div class="thread-sep">スレッド 2</div>
      <div class="card" data-id="my-post#1">
      <div class="card-head">
      <label class="done"><input type="checkbox" class="done-cb" data-id="my-post#1"> 完了</label>
      <span class="cid">#2</span>
      <button type="button" class="copy" data-id="my-post#1">📋 コピー</button>
      </div>
      <textarea class="md" spellcheck="false" data-id="my-post#1">翻訳済み本文</textarea>
      </div>
      </section>
      <script>
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
      </script>
      </body></html>
      "
    `);
  });
});
