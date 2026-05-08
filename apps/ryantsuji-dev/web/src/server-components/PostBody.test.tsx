/**
 * `PostBody` server component の SSR test。
 *
 * server component は client / SSR どちらの context でも plain function として
 * render できる (rsc protocol は build-time bundling のみ)。`renderToString` で
 * 直接 render し、出力 HTML を **inline snapshot で固定** する (article wrap +
 * dangerouslySetInnerHTML 経路を機械的に検証)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business PostBody が article wrap + html 流入を行う仕様を inline snapshot で保証。renderMarkdown 出力を渡しても XSS-suspect な変換を加えない pure な server component
 * @graph-connects none
 */

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PostBody } from "./PostBody.js";

describe("PostBody", () => {
  it("html prop を article.post-body 直下にそのまま挿入する", () => {
    expect(renderToString(<PostBody html='<h2 id="x">hi</h2><p>body</p>' />)).toMatchInlineSnapshot(
      `"<article class="post-body"><h2 id="x">hi</h2><p>body</p></article>"`,
    );
  });

  it("空文字 html でも article tag は出る (空 article)", () => {
    expect(renderToString(<PostBody html="" />)).toMatchInlineSnapshot(
      `"<article class="post-body"></article>"`,
    );
  });
});
