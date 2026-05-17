/**
 * `zenn-directives.ts` の pure helper の分岐網羅 test。
 *
 * 1. `normalizeZennMessageAlert` の文字列書き換え (行頭・空白・閉じ delim 影響なし)
 * 2. `remarkDirectiveCallouts` 経由で render された HTML が `<aside class="callout
 *    callout-info|alert">` を含むこと
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business zenn-directives.ts の pure helper の分岐網羅 test。`:::message` / `:::message alert` の正規化 + remark directive 経由の HTML 出力 + 他 directive (`:::unknown`) を触らない不変条件を確認
 * @graph-connects none
 */

import rehypeStringify from "rehype-stringify";
import remarkDirective from "remark-directive";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { describe, expect, it } from "vitest";

import { normalizeZennMessageAlert, remarkDirectiveCallouts } from "./zenn-directives.js";

/** 共通 helper: zenn-directive 経由の HTML を作る。test 内専用なので shiki 等は省く。 */
async function renderHtml(md: string): Promise<string> {
  const normalized = normalizeZennMessageAlert(md);
  const file = await unified()
    .use(remarkParse)
    .use(remarkDirective)
    .use(remarkDirectiveCallouts)
    .use(remarkRehype)
    .use(rehypeStringify)
    .process(normalized);
  return String(file);
}

describe("normalizeZennMessageAlert", () => {
  it("行頭 `:::message alert` を `:::message-alert` に書き換え", () => {
    const md = [":::message alert", "warning body", ":::"].join("\n");
    expect(normalizeZennMessageAlert(md)).toContain(":::message-alert");
    expect(normalizeZennMessageAlert(md)).not.toContain(":::message alert");
  });

  it("`:::message` (alert なし) は触らない", () => {
    const md = [":::message", "info body", ":::"].join("\n");
    expect(normalizeZennMessageAlert(md)).toBe(md);
  });

  it("行頭でない `:::message alert` (例: コード block 内) は触らない", () => {
    const md = ["```", "  :::message alert", "```"].join("\n");
    expect(normalizeZennMessageAlert(md)).toBe(md);
  });

  it("内部複数空白も alert 認識する (= ZennでもOK な揺らぎを吸収)", () => {
    const md = [":::message    alert", "body", ":::"].join("\n");
    expect(normalizeZennMessageAlert(md)).toContain(":::message-alert");
  });

  it("前置 indent (例: 4-space) は触らない (= directive 認識されない仕様に合わせる)", () => {
    const md = ["    :::message alert", "    body", "    :::"].join("\n");
    expect(normalizeZennMessageAlert(md)).toBe(md);
  });
});

describe("remarkDirectiveCallouts (via render pipeline)", () => {
  it('`:::message` → `<aside class="callout callout-info">`', async () => {
    const html = await renderHtml([":::message", "info body", ":::"].join("\n"));
    expect(html).toContain('<aside class="callout callout-info">');
    expect(html).toContain("info body");
    expect(html).toContain("</aside>");
  });

  it('`:::message alert` → `<aside class="callout callout-alert">`', async () => {
    const html = await renderHtml([":::message alert", "alert body", ":::"].join("\n"));
    expect(html).toContain('<aside class="callout callout-alert">');
    expect(html).toContain("alert body");
  });

  it("未知の directive (`:::unknown`) は変換しない (= デフォルト挙動を維持)", async () => {
    const html = await renderHtml([":::unknown", "raw body", ":::"].join("\n"));
    expect(html).not.toContain("callout-info");
    expect(html).not.toContain("callout-alert");
    expect(html).toContain("raw body");
  });

  it("callout 内の inline markdown は通常通り render", async () => {
    const html = await renderHtml(
      [":::message", "**bold** and `code` and [link](https://example.com)", ":::"].join("\n"),
    );
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain('href="https://example.com"');
  });
});
