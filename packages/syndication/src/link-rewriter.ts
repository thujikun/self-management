/**
 * markdown 中の内部 link `/posts/<slug>` を syndication target の公開 URL に書き換える。
 *
 * ryantsuji.dev は SoT として `/posts/<slug>` の相対 link を書き、syndication 時に
 * 当該 lang の Zenn / dev.to URL に展開する。target URL は呼び出し側で **resolver
 * 関数** として渡す (ファイル I/O や DB 参照をこの module に閉じ込めない設計)。
 *
 * 想定 input:
 *   [テキスト](/posts/db-graph-mcp)
 *   [テキスト](/posts/db-graph-mcp#section-id)
 *   [テキスト](/posts/db-graph-mcp?lang=ja)
 *
 * resolver が null を返した場合は link をそのまま残す (= 該当 target に
 * syndicate されていない post を内部リンクしている = 警告ケース)。実 publish
 * 層は warn を出すこと。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business markdown 内の /posts/<slug> 相対 link を、resolver 経由で外部公開 URL に置き換える pure 変換。fragment (#section) / query (?lang=) は保持し、resolver が null を返したら link を変更せず残す (publish 層で警告)
 * @graph-connects none
 */

/**
 * resolver: slug → 公開 URL (該当 target に未配信なら null)。
 *
 * @graph-connects none
 */
export type SlugResolver = (slug: string) => string | null;

/**
 * markdown text 内の `](/posts/<slug>...)` を resolver の戻り値に置換する。
 *
 * @graph-connects none
 */
export function rewriteInternalLinks(content: string, resolver: SlugResolver): string {
  // `[text](/posts/<slug>...)` 形式。slug は kebab-case + 数字 + 末尾 _ (test fixture
  // 用) を許容。大文字混じり slug は本 repo の slug 規約違反のため regex 段で素通しさせ、
  // resolver を呼ばずに publish 層に判断を委ねる (大文字許容で resolver が hit せず
  // 「未配信」扱いになるのを避ける)。fragment / query は捕捉して resolver 出力に concat。
  return content.replace(
    /\]\(\/posts\/([_a-z0-9][_a-z0-9-]*)([#?][^)]*)?\)/g,
    (match, slug: string, suffix?: string) => {
      const external = resolver(slug);
      if (!external) return match;
      return `](${external}${suffix ?? ""})`;
    },
  );
}
