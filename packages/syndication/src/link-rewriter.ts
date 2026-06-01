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
 * 加えて `rewriteImageLinks` で `/images/...` 相対 URL を `<host>/images/...` に
 * 絶対化する変換も提供する (syndication 先で `/images/` が当該ドメインに解決され
 * 404 になるのを防ぐ)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business markdown 内の相対 link を syndication target 用に絶対化する pure 変換。/posts/<slug> は resolver 経由で外部公開 URL へ、/images/* は ryantsuji.dev base URL を prefix。fragment (#section) / query (?lang=) は保持
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

/**
 * resolver: `/images/<path>` → 画像 content hash (例: sha256 prefix 8 chars)。
 * `null` を返したら hash を URL に付けない (= 解決失敗時は素通り)。
 *
 * @graph-connects none
 */
export type ImageHashResolver = (imagePath: string) => string | null;

/**
 * markdown 内の `/images/...` 相対 URL を `<baseUrl>/images/...` の絶対 URL に置換する。
 *
 * ryantsuji.dev では post 添付画像を `![alt](/images/posts/<slug>/<file>)` で参照するが、
 * dev.to / Zenn に syndicate するとそのドメインで解決され 404 になる。配信元は常に
 * ryantsuji.dev (R2 経由) なので、syndicate 時に絶対 URL に書き換えて配信元を固定する。
 *
 * `]\(/images/` で始まる pattern を取れば markdown image `![alt](...)` も link
 * `[text](...)` も両方拾える。`baseUrl` は trailing slash 無し前提 (`https://ryantsuji.dev`)。
 *
 * `hashResolver` が渡された場合は、各 image path に対して `?v=<hash>` を URL に
 * 付与する (= cache-buster)。dev.to image optimizer (`media2.dev.to/cdn-cgi/image
 * /...`) は source URL を cache key にするため、PNG だけ更新して URL が同一だと
 * 古い画像がキャッシュから返り続ける。画像 hash を URL に乗せれば、画像差分で
 * URL が変わって optimizer が再 fetch する。既存の fragment (`#section`) / query
 * (`?w=600`) は **保持** しつつ `?v=...` を append する (既存 `?` が有れば
 * `?v=...&...`、無ければ `?v=...`)。
 *
 * @graph-connects none
 */
export function rewriteImageLinks(
  content: string,
  baseUrl: string,
  hashResolver?: ImageHashResolver,
): string {
  if (!hashResolver) {
    return content.replace(/\]\(\/images\//g, `](${baseUrl}/images/`);
  }
  // image path + optional suffix (`#frag` / `?query`) を分離して捕捉する。`)` の手前
  // までを path と suffix にきれいに分けることで、`?v=` を suffix の前 (= path 直後)
  // に挿入できる。
  return content.replace(
    /\]\(\/images\/([^)#?]+)([#?][^)]*)?\)/g,
    (_match, path: string, suffix?: string) => {
      const imagePath = `/images/${path}`;
      const hash = hashResolver(imagePath);
      const existing = suffix ?? "";
      if (!hash) {
        // hash 解決失敗時は cache-buster を付けず、絶対化のみ実施 (= 解決対象外画像を
        // syndication で 404 にしないため)。
        return `](${baseUrl}/images/${path}${existing})`;
      }
      const buster = `v=${hash}`;
      let combinedSuffix: string;
      if (!existing) {
        combinedSuffix = `?${buster}`;
      } else if (existing.startsWith("#")) {
        combinedSuffix = `?${buster}${existing}`;
      } else {
        // existing.startsWith("?") — 既存 query パラメータの前に `v=` を挿入
        combinedSuffix = `?${buster}&${existing.slice(1)}`;
      }
      return `](${baseUrl}/images/${path}${combinedSuffix})`;
    },
  );
}
