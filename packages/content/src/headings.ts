/**
 * markdown 本文 (frontmatter 除外後) から H2/H3 見出しを抽出して TOC データを返す。
 *
 * GitHub Flavored Markdown ベース。ATX (`# heading`) のみ対応 (本サイトは ATX のみ運用)。
 * code fence (``` または ~~~) 内の `#` 行は見出しと誤検出しないよう除外する。
 *
 * slug 化は **rehype-slug が内部で使う `github-slugger` を直接利用**。これにより
 * 日本語混じり見出しでも `extractHeadings` の id と HTML 側の `<h2 id="...">` が
 * 完全一致 (Unicode 保持 + 同名重複時の suffix も同一)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business markdown 本文から TOC 用 heading を抽出する pure 関数。rehype-slug と同じ github-slugger 実装で id を生成し、Unicode 見出しと重複見出しの両方で TOC リンク先と HTML anchor を一致させる
 * @graph-connects github-slugger [calls] rehype-slug 互換の slug を作るため、各 instance で重複検知 state を持たせる
 */

import GithubSlugger from "github-slugger";

/** @graph-connects none */
export interface Heading {
  level: 2 | 3;
  text: string;
  id: string;
}

/**
 * GFM heading text を anchor id に。
 *
 * 単発呼び出し用 (重複検知 state を持たない)。本サイトの TOC リンクで複数 heading を
 * 同 id にしないよう、`extractHeadings` 側では 1 instance を共有して通すこと。
 *
 * @graph-connects github-slugger [calls] new instance を毎回作るので state なし
 */
export function slugify(text: string): string {
  return new GithubSlugger().slug(text);
}

/**
 * markdown 本文から H2/H3 を順序通りに抽出。
 *
 * 同 instance の `GithubSlugger` を再利用し、同名見出し重複時の suffix
 * (`foo` / `foo-1` / `foo-2`) を rehype-slug の挙動と完全一致させる。
 *
 * @graph-connects github-slugger [calls] 1 通読あたり 1 slugger instance
 */
export function extractHeadings(body: string): Heading[] {
  const slugger = new GithubSlugger();
  const lines = body.split("\n");
  const out: Heading[] = [];
  let inFence = false;
  // open した fence の delimiter を記憶 (``` で開いたら ``` で閉じる、~~~ も同様)。
  // 異種 delimiter で fence は閉じない (CommonMark 仕様)。
  let fenceDelim: "```" | "~~~" | null = null;
  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(```|~~~)/);
    if (fenceMatch) {
      const delim = fenceMatch[1] as "```" | "~~~";
      if (!inFence) {
        inFence = true;
        fenceDelim = delim;
      } else if (delim === fenceDelim) {
        inFence = false;
        fenceDelim = null;
      }
      continue;
    }
    if (inFence) continue;
    const m = line.match(/^(#{2,3})\s+(.+?)\s*#*\s*$/);
    if (!m) continue;
    const level = m[1].length as 2 | 3;
    const text = m[2].trim();
    out.push({ level, text, id: slugger.slug(text) });
  }
  return out;
}

/**
 * markdown 本文を素朴に単語分割して reading time を分単位で返す。
 *
 * 日本語は文字数 / 500 = 分 (medium 系の経験則)、英数字は単語数 / 220。
 * 本サイトは ja / en 両方ありうるので、どちらか大きい方の上限を採用。
 *
 * @graph-connects none
 */
export function estimateReadingTimeMinutes(body: string): number {
  const stripped = body
    .replace(/```[\s\S]*?```/g, "") // backtick code fence 除外
    .replace(/~~~[\s\S]*?~~~/g, "") // tilde code fence 除外
    .replace(/`[^`]*`/g, "") // inline code 除外
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // image 除外
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1"); // link は text のみ残す
  const cjk = (stripped.match(/[぀-ヿ一-鿿]/g) ?? []).length;
  const words = (stripped.match(/[a-zA-Z0-9]+/g) ?? []).length;
  const minutes = Math.max(cjk / 500, words / 220);
  return Math.max(1, Math.ceil(minutes));
}
