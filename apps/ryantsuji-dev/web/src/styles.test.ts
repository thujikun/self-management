/**
 * `styles.css` の機械検査が必要な「tap-target contract」を assert する。
 *
 * happy-dom は CSS layout を計算しないため、`getBoundingClientRect()` で実寸を
 * 測るタイプの test は flat に書けない。代わりに styles.css の rule block を
 * 直接読み出し、WCAG 2.2 SC 2.5.8 を満たすための CSS 宣言が selector に紐付いて
 * いることを literal で検査する。短 tag (例: `#x`) が rule から漏れた瞬間に
 * silent regress する経路を、CSS 改変の段階で機械的に止める。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business styles.css の WCAG target-size 関連 rule (footer link / tag chip) が min-width 24px + min-height 24px + center align を保持しているかを CSS source 直読みで gate し、短 tag や 短 footer link の silent regress を機械検知する
 * @graph-connects none
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const STYLES_PATH = resolve(HERE, "./styles.css");

/**
 * styles.css 全文から、ある CSS selector の rule block (`{ ... }`) を 1 つ抜き出す。
 * 同 selector が複数定義されている場合は最初の block を返す。
 *
 * @graph-connects none
 */
function extractRuleBlock(css: string, selector: string): string {
  const idx = css.indexOf(selector);
  if (idx < 0) throw new Error(`selector not found: ${selector}`);
  const openBrace = css.indexOf("{", idx);
  if (openBrace < 0) throw new Error(`opening brace not found for ${selector}`);
  let depth = 0;
  for (let i = openBrace; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(openBrace + 1, i);
    }
  }
  throw new Error(`closing brace not found for ${selector}`);
}

/**
 * rule block 文字列から、`prop: value` 形式の宣言を抽出して map にする。
 * value 末尾の `;` と前後 whitespace は剥がす。block コメントは事前除去する。
 *
 * @graph-connects none
 */
function parseDeclarations(ruleBody: string): Record<string, string> {
  const withoutComments = ruleBody.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Record<string, string> = {};
  for (const raw of withoutComments.split(";")) {
    const line = raw.trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    out[key] = value;
  }
  return out;
}

describe("styles.css — WCAG 2.2 SC 2.5.8 tap-target contract", () => {
  const css = readFileSync(STYLES_PATH, "utf8");

  it("`.post-detail__tags > li > a` は短 tag (1-2 字) でも 24x24px 以上を確保する", () => {
    // padding-inline (var(--space-1) = 4px) だけだと `#x` で box 幅が 14-18px に
    // 留まり SC 2.5.8 を割る。min-width + justify-content で CSS 側に floor を置く。
    const decls = parseDeclarations(extractRuleBlock(css, ".post-detail__tags > li > a"));
    expect(decls["min-width"]).toStrictEqual("24px");
    expect(decls["min-height"]).toStrictEqual("24px");
    expect(decls["justify-content"]).toStrictEqual("center");
    expect(decls["align-items"]).toStrictEqual("center");
    expect(decls["display"]).toStrictEqual("inline-flex");
  });

  it("`.site-footer a` も短 link (X / RSS) で 24x24px 以上を確保する", () => {
    // PR #107 で踏んだ regression と同 contract。footer link の floor も
    // 同じ CSS gate に乗せて、tag chip と footer link 両方を一括で守る。
    const decls = parseDeclarations(extractRuleBlock(css, ".site-footer a"));
    expect(decls["min-width"]).toStrictEqual("24px");
    expect(decls["min-height"]).toStrictEqual("24px");
    expect(decls["justify-content"]).toStrictEqual("center");
    expect(decls["align-items"]).toStrictEqual("center");
    expect(decls["display"]).toStrictEqual("inline-flex");
  });
});
