/**
 * markdown 本文 (frontmatter 除外後) から H2/H3 見出しを抽出して TOC データを返す。
 *
 * GitHub Flavored Markdown ベース。`setext` (`====` / `----`) ではなく ATX
 * (`# heading`) のみ対応 (本サイトは ATX のみ運用)。code fence 内の `#` 行は
 * 見出しと誤検出しないよう除外する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business markdown 本文から TOC 用 heading を抽出する pure 関数。rehype-slug が付与する id と同じアルゴリズムで slug 化することで、レンダ済 HTML の anchor と TOC リンクを一致させる
 * @graph-connects none
 */

/** @graph-connects none */
export interface Heading {
  level: 2 | 3;
  text: string;
  id: string;
}

/**
 * GFM heading text を anchor id に。rehype-slug の `github-slugger` 互換 (簡易版):
 *
 * - lowercase
 * - whitespace → `-`
 * - alphanumeric / `-` / `_` 以外を除去
 * - 連続 `-` を 1 つに
 * - 端の `-` を trim
 *
 * @graph-connects none
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-_]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * markdown 本文から H2/H3 を順序通りに抽出。
 *
 * @graph-connects none
 */
export function extractHeadings(body: string): Heading[] {
  const lines = body.split("\n");
  const out: Heading[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = line.match(/^(#{2,3})\s+(.+?)\s*#*\s*$/);
    if (!m) continue;
    const level = m[1].length as 2 | 3;
    const text = m[2].trim();
    out.push({ level, text, id: slugify(text) });
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
    .replace(/```[\s\S]*?```/g, "") // code fence 除外
    .replace(/`[^`]*`/g, "") // inline code 除外
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // image 除外
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1"); // link は text のみ残す
  const cjk = (stripped.match(/[぀-ヿ一-鿿]/g) ?? []).length;
  const words = (stripped.match(/[a-zA-Z0-9]+/g) ?? []).length;
  const minutes = Math.max(cjk / 500, words / 220);
  return Math.max(1, Math.ceil(minutes));
}
