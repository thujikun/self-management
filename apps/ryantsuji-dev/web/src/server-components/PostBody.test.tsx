/**
 * `PostBody` server component の SSR test。
 *
 * server component は client / SSR どちらの context でも plain function として
 * render できる (rsc protocol は build-time bundling のみ)。`renderToString` で
 * 直接 render し、article wrap + dangerouslySetInnerHTML 経由の HTML 流入を確認する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business PostBody が article wrap + html 流入を行う仕様の保証。renderMarkdown 出力を渡しても XSS-suspect な変換を加えない pure な server component
 * @graph-connects none
 */

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PostBody } from "./PostBody.js";

describe("PostBody", () => {
  it("article wrapper + post-body class + html を流す", () => {
    const html = renderToString(<PostBody html='<h2 id="x">hi</h2><p>body</p>' />);
    expect(html).toContain('<article class="post-body"');
    expect(html).toContain('<h2 id="x">hi</h2>');
    expect(html).toContain("<p>body</p>");
  });

  it("空文字 html でも article tag は出る", () => {
    const html = renderToString(<PostBody html="" />);
    expect(html).toContain('<article class="post-body"');
  });
});
