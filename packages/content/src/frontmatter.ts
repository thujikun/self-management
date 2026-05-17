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
   * cover image の **public/ からの絶対 path**。例: `/posts/<slug>.cover.png`。
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
          id: z.string().min(1),
        })
        .optional(),
      devto: z
        .object({
          id: z.number().int().positive(),
          slug: z.string().min(1),
        })
        .optional(),
    })
    .default({}),
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
