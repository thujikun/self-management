/*
 * check-devto-slug-fresh logic — content/posts/*.en.md の frontmatter で、dev.to
 * 公開済みのはずの post に `-temp-slug-NNNNN` が残っていないか検査する pure 層。
 *
 * Why: dev.to は draft article に `-temp-slug-NNNNN` 付きの暫定 slug を割り当て、
 * 公開時にこれを剥がして canonical slug にする。`-temp-slug-` 付き slug の URL は
 * 公開後 404 になるため、`syndication.devto.slug` がこれを抱えたままだと
 * link-rewriter が 404 URL を他記事の body に rewrite して埋め込む事故になる
 * (実例: cortex-product-graph → cortex-auto-review のリンクが temp-slug 残しの
 * 404 URL に rewrite された)。
 *
 * Sensor (`scripts/syndicate.ts` の PUT-time slug reconcile) が一次防衛線だが、PUT は
 * `contentHash` 一致時に skip するため publish 直後から次の body 変更までの間 stored
 * slug が腐ったままになるウィンドウが残る。本 Guide は CI でその腐敗状態を block
 * する belt-and-suspenders。
 *
 * 判定: `syndication.devto.slug` に `-temp-slug-` を含み、かつ post の dev.to publish
 * 時刻 (devto.publishAt がなければ publishedAt) が `now` より過去 = 既に公開された
 * はず、なら violation。draft window (publish 前) の post は弾かない。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business devto-slug-fresh gate の pure 層。post frontmatter 配列 + 現在時刻を受け取り、syndication.devto.slug に -temp-slug- を抱えたまま publish 時刻を過ぎた post を file:slug:publishAt で列挙する。PUT-time reconcile が当たらないウィンドウで stored slug が腐り link-rewriter が 404 を埋め込む事故を CI で block する
 * @graph-connects none
 */

/** 検査対象 1 件。`file` は表示用、`devtoSlug` / `publishAt` は frontmatter 由来。 */
export interface DevtoSlugCheckPost {
  file: string;
  devtoSlug?: string;
  /** dev.to 公開時刻。`syndication.devto.publishAt` 優先、無ければ `publishedAt` を渡す。 */
  publishAt?: string;
}

/** 違反 1 件。CLI が stderr に出して exit 1 する。 */
export interface StaleSlugViolation {
  file: string;
  slug: string;
  publishAt: string;
}

/**
 * `posts` の中から「`devtoSlug` に `-temp-slug-` を含み、`publishAt` <= `now`」な
 * 要素を violation として返す。publish 前 (publishAt > now) や devtoSlug 未設定の
 * post は素通し。
 *
 * @graph-connects none
 */
export function collectStaleSlugViolations(
  posts: ReadonlyArray<DevtoSlugCheckPost>,
  now: Date,
): StaleSlugViolation[] {
  const violations: StaleSlugViolation[] = [];
  for (const p of posts) {
    if (!p.devtoSlug || !p.publishAt) continue;
    if (!p.devtoSlug.includes("-temp-slug-")) continue;
    const publishTs = Date.parse(p.publishAt);
    // parse 失敗 (NaN) は不正値なので safety で弾かず素通し (= check-posts-frontmatter 側で別途検出される想定)
    if (Number.isNaN(publishTs)) continue;
    // publish 前 (まだ draft window の中) はスキップ。POST 直後の温存期間。
    if (publishTs > now.getTime()) continue;
    violations.push({ file: p.file, slug: p.devtoSlug, publishAt: p.publishAt });
  }
  return violations;
}
