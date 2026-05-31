/**
 * markdown frontmatter の Zod schema + parse helper。
 *
 * 投稿には title / publishedAt が必須。`slug` / `lang` は **ファイル名 (`<slug>.<lang>.md`)
 * を authoritative** に扱うため schema には載せない (呼び出し側で filename 由来の値を
 * 付与する)。tags / summary は任意。`canonical` は cross-syndication (Zenn / dev.to)
 * で original URL を逆算するため。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business markdown frontmatter の SSoT schema。投稿の必須/任意 field を Zod で定義し、parse 時に validation + 既定値付与を行う。slug / lang はファイル名から導出する authoritative な値のため schema には含めない。各種 syndication target (Zenn/dev.to) で参照する canonical URL も meta として持つ
 * @graph-connects none
 */

import { z } from "zod";

/**
 * frontmatter の Zod schema。
 *
 * - `title` / `publishedAt` 必須
 * - `slug` / `lang` は **持たない** (filename `<slug>.<lang>.md` が authoritative
 *   で、frontmatter 側の値は採用しない方針)。既存 markdown に書かれていても
 *   `z.object` の strip 挙動で silently drop される
 * - `tags` は重複削除 + 小文字化
 *
 * @graph-connects none
 */
export const FrontmatterSchema = z.object({
  title: z.string().min(1),
  publishedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}/, "ISO date prefix (YYYY-MM-DD) required"),
  updatedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}/)
    .optional(),
  summary: z.string().optional(),
  tags: z
    .array(z.string())
    .default([])
    .transform((arr) => Array.from(new Set(arr.map((t) => t.toLowerCase()))).sort()),
  canonical: z.string().url().optional(),
  draft: z.boolean().default(false),
  /**
   * cover image の **public/ からの絶対 path**。例: `/images/posts/<slug>.cover.png`。
   * ryantsuji.dev では `<meta property="og:image">` に、Zenn / dev.to syndication
   * では `cover_image` field に絶対 URL 化して渡す。
   */
  cover: z.string().startsWith("/").optional(),
  /**
   * 連載 (series) の slug。同じ slug を持つ post が同じ series hub
   * (`/series/<slug>`) に集約される。例: `"building-ai-harness"`。`title` field は
   * series hub 側の `series.config.ts` で別途定義する設計 (= post 側は slug 参照だけ
   * 持つことで、連載タイトルが changed しても全 post を再編集しなくて済む)。
   */
  series: z.string().min(1).optional(),
  /**
   * 同 series 内での順序 (Part 1 = 1, Part 2 = 2, ...)。表示順 + nav 構築に使う。
   * 未指定なら publishedAt 昇順 fallback。
   */
  seriesOrder: z.number().int().positive().optional(),
  /**
   * syndication target の外部 ID マップ。`packages/syndication` がここを引いて
   * publish / 内部 link 解決をする。値が無い post は当該 target に syndicate しない。
   *
   * - `zenn.id`: Zenn article id (e.g. `d9fc317c1336c2`)。Zenn GitHub sync repo 内の
   *   `articles/<id>.md` のファイル名にもなる
   * - `devto.id`: dev.to numeric article id (API `PUT /api/articles/{id}` で参照)
   * - `devto.slug`: dev.to URL slug (公開 URL `https://dev.to/<user>/<slug>` の最後)
   */
  syndication: z
    .object({
      zenn: z
        .object({
          /**
           * Zenn article id。**optional**: post を予約だけして (publishAt のみ設定)
           * まだ Zenn に作成していない状態を valid にするため。id 不在の block を
           * syndicate が検出したら新規 id を生成して書き戻す。
           */
          id: z.string().min(1).optional(),
          /**
           * Zenn 公開時刻。未設定なら `publishedAt` と同時に公開。設定時は `publishAt`
           * 到達まで `published: false` (Zenn 側 draft) のまま保たれる。媒体ごとに公開
           * 時刻をずらす用途 (= ryantsuji.dev は先行公開、Zenn は後で公開) で使う。
           */
          publishAt: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}/, "ISO date prefix (YYYY-MM-DD) required")
            .optional(),
        })
        .optional(),
      devto: z
        .object({
          /**
           * dev.to numeric article id。**optional**: post を予約だけして (publishAt
           * のみ設定) まだ dev.to に作成していない状態を valid にするため。id 不在の
           * block を syndicate が検出したら POST で作成して id/slug を書き戻す。
           */
          id: z.number().int().positive().optional(),
          /** dev.to URL slug。id と同様 optional (= 未作成 post では不在)。 */
          slug: z.string().min(1).optional(),
          /** dev.to 公開時刻。zenn と同じ意味。 */
          publishAt: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}/, "ISO date prefix (YYYY-MM-DD) required")
            .optional(),
          /**
           * 直近の PUT で送った article body の sha256 prefix (16 hex chars)。
           * `scripts/syndicate.ts:emitDevto` が新規 article 作成時 / 内容変更時に
           * 書き戻し、以後の cron run で hash 一致なら PUT を skip する idempotency
           * marker。dev.to の PUT は body 同一でも `edited_at` を bump するため、
           * 毎 15 分の cron で全 article の更新日が今日になる事故を防ぐ。
           */
          contentHash: z.string().min(8).optional(),
        })
        .optional(),
    })
    .default({}),
  /**
   * `true` で `scripts/syndicate.ts:readAllPosts` から除外され Zenn / dev.to に
   * 連携されない。ryantsuji.dev だけに公開したい post で使う。未指定 = 通常通り
   * syndicate される (= 呼び出し側は truthy check で判定する)。`.default(false)`
   * にすると `Frontmatter` の output 型が必須 boolean になり、`Frontmatter` を
   * extends する downstream の test fixture (apps/ryantsuji-dev/web 等) を全て
   * 同時更新する必要が出るため、optional で `boolean | undefined` に倒している。
   */
  excludeFromSyndication: z.boolean().optional(),
});

/** @graph-connects none */
export type Frontmatter = z.infer<typeof FrontmatterSchema>;

/**
 * gray-matter で抽出した data オブジェクトを Zod で validate して `Frontmatter` に。
 *
 * @graph-connects none
 */
export function parseFrontmatter(data: unknown): Frontmatter {
  return FrontmatterSchema.parse(data);
}
