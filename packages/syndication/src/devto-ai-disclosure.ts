/**
 * dev.to 配信時に AI assistance disclosure を本文先頭に prepend する pure 変換。
 *
 * dev.to の community guidelines (https://dev.to/p/editor_guide) は、 AI を使って
 * 執筆した記事には disclosure を入れることを求めている。 ryantsuji.dev の SoT
 * markdown には disclosure を含めず、 dev.to 配信時にのみ自動付与することで「JA
 * (Zenn / ryantsuji.dev) には不要、 EN (dev.to) には必須」を一元管理する。
 *
 * disclosure 文言は本 module の `AI_DISCLOSURE_MARKDOWN` を SoT とし、 既に同
 * marker (`<!-- ai-disclosure -->`) を含む body は二重 prepend しない (idempotent)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business dev.to 配信時に AI assistance disclosure を本文先頭に prepend する pure 変換。marker comment で idempotent を保ち、 dev.to community guidelines (AI 執筆記事の disclosure 必須) に追従する
 * @graph-connects none
 */

/**
 * dev.to 配信記事の冒頭に挿入する AI assistance disclosure 文言。 HTML comment
 * `<!-- ai-disclosure -->` は二重 prepend 防止の marker として機能する (markdown
 * render 時には不可視)。
 *
 * @graph-connects none
 */
export const AI_DISCLOSURE_MARKDOWN =
  "<!-- ai-disclosure -->\n" +
  "> _AI assistance disclosure: This article was drafted with the help of Claude. " +
  "All technical content, design decisions, code references, and screenshots reflect " +
  "production systems I designed and operate at airCloset; the prose was revised by me " +
  "prior to publication._";

/** @graph-connects none */
const DISCLOSURE_MARKER = "<!-- ai-disclosure -->";

/**
 * `body` の先頭に AI disclosure を prepend する。 既に同 marker を含む body は
 * そのまま返す (idempotent)。 body 先頭の余分な空白は剥がし、 disclosure と本文
 * の間に空行を 1 つ挟む。
 *
 * @graph-connects none
 */
export function prependAiDisclosure(body: string): string {
  if (body.includes(DISCLOSURE_MARKER)) return body;
  const trimmed = body.replace(/^\s+/u, "");
  return `${AI_DISCLOSURE_MARKDOWN}\n\n${trimmed}`;
}
