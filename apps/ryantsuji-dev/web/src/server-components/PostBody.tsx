/**
 * markdown render 結果 (HTML 文字列) を server component として描画する。
 *
 * `renderMarkdown` の出力は shiki / autolink / heading id を含む信頼できる HTML。
 * server-only で render され、client は React Flight stream として受け取るだけ。
 * (`@self/content` の入力は repo 内 markdown のみで XSS 攻撃面はない。)
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business RSC を経由して route loader 側から markdown HTML を渡す server component。レンダ済 HTML の article wrap + class 付与だけを担当し、shiki / unified の重 dep は server bundle に閉じる
 * @graph-connects react [embeds] dangerouslySetInnerHTML で renderMarkdown 出力を流す
 */

/** @graph-connects none */
export function PostBody({ html }: { html: string }) {
  return <article className="post-body" dangerouslySetInnerHTML={{ __html: html }} />;
}
