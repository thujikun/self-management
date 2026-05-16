/**
 * syndication target 別の footer を本文末尾に append する。
 *
 * Zenn 配信時のみ採用 footer (`config/footers/zenn.ja.md`) を末尾に付加する想定。
 * ryantsuji.dev 本体 + dev.to の .md には footer を含めず、Zenn 専用の付加要素として扱う。
 *
 * footer 本体は file system から resolver 経由で渡す (= この pure module は I/O を
 * 持たない。呼び出し側 CLI が file 読み込み済の文字列を渡す)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business syndication target 別 footer を本文末尾に append する pure 変換。footer 文字列は呼び出し側で読み込み、本 module は append 規約 (前後改行) だけを担当する
 * @graph-connects none
 */

/**
 * `body` の末尾に `footer` を改行付きで append する。`footer` が空文字列 / null の
 * 場合は body をそのまま返す (= 該当 target に footer 不要なケース)。
 *
 * 既存 body が末尾改行を含む / 含まないどちらでも、間に常に 1 行の空行を挟む。
 *
 * @graph-connects none
 */
export function appendFooter(body: string, footer: string | null | undefined): string {
  if (!footer || footer.trim().length === 0) return body;
  const trimmedBody = body.replace(/\s+$/u, "");
  const trimmedFooter = footer.replace(/^\s+|\s+$/gu, "");
  return `${trimmedBody}\n\n${trimmedFooter}\n`;
}
