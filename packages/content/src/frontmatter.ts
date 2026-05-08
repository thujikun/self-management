/**
 * markdown frontmatter の Zod schema + parse helper。
 *
 * 投稿には title / publishedAt が必須。slug は file 名から導出するか
 * frontmatter で明示。tags / summary は任意。`canonical` は cross-syndication
 * (Zenn / dev.to) で original URL を逆算するため。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business markdown frontmatter の SSoT schema。投稿の必須/任意 field を Zod で定義し、parse 時に validation + 既定値付与を行う。各種 syndication target (Zenn/dev.to) で参照する canonical URL も meta として持つ
 * @graph-connects none
 */

import { z } from "zod";

/**
 * frontmatter の Zod schema。
 *
 * - `title` / `publishedAt` 必須
 * - `slug` は frontmatter で override 可能 (なければ呼び出し側でファイル名から付与)
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
  slug: z.string().optional(),
  summary: z.string().optional(),
  tags: z
    .array(z.string())
    .default([])
    .transform((arr) => Array.from(new Set(arr.map((t) => t.toLowerCase()))).sort()),
  canonical: z.string().url().optional(),
  draft: z.boolean().default(false),
  lang: z.enum(["ja", "en"]).default("ja"),
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
