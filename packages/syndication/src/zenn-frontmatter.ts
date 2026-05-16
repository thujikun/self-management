/**
 * Zenn 用 frontmatter ビルダー。
 *
 * Zenn GitHub sync repo の `articles/<id>.md` は固有の YAML frontmatter shape を
 * 要求する (`title` / `emoji` / `type` / `topics` / `published` / `publication_name`)。
 * ryantsuji.dev 側の `Frontmatter` を変換して Zenn 互換の YAML 文字列を返す。
 *
 * Zenn frontmatter spec: https://zenn.dev/zenn/articles/zenn-cli-guide
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business ryantsuji.dev の Frontmatter を Zenn 用に変換する pure builder。emoji default は `🤖` (Ryan の AI / 自動化テーマに揃え)、type は `tech` 固定、publication_name は aircloset org 配下に publish するため固定指定
 * @graph-connects content [reads_from] @self/content の Frontmatter type を入力に取る
 */

import type { Frontmatter } from "@self/content";

/**
 * Zenn frontmatter の TS 表現。生成後 YAML.stringify するため shape を厳密化。
 *
 * @graph-connects none
 */
export interface ZennFrontmatter {
  title: string;
  emoji: string;
  type: "tech" | "idea";
  topics: string[];
  published: boolean;
  publication_name?: string;
}

/**
 * options。emoji と publication_name は記事ごとに変えたいので injection 化。
 *
 * @graph-connects none
 */
export interface ZennBuildOptions {
  /** title 横に出る Zenn の emoji。default `🤖`。 */
  emoji?: string;
  /** Zenn publication (会社 org) 配下に publish する場合の name。default `aircloset`。 */
  publicationName?: string | null;
}

/**
 * `Frontmatter` → `ZennFrontmatter`。topics は Zenn の制約 (5 つまで、kebab-case
 * + alphanumeric + 一部記号) に合わせ最大 5 件に truncate。
 *
 * @graph-connects content [reads_from] Frontmatter から title / tags / draft を抽出
 */
export function buildZennFrontmatter(
  meta: Frontmatter,
  options: ZennBuildOptions = {},
): ZennFrontmatter {
  return {
    title: meta.title,
    emoji: options.emoji ?? "🤖",
    type: "tech",
    topics: meta.tags.slice(0, 5),
    published: !meta.draft,
    ...(options.publicationName !== null
      ? { publication_name: options.publicationName ?? "aircloset" }
      : {}),
  };
}

/**
 * `ZennFrontmatter` を YAML 文字列に直列化。`---` で挟む形まで含めて返すので
 * markdown body の前に直接 concat できる。
 *
 * Note: 単純なフィールドのみで配列も string 配列のみなので、外部 yaml library に
 * 依存せず手で書く。複雑な構造を追加する時に library に切り替え可能。
 *
 * @graph-connects none
 */
export function stringifyZennFrontmatter(fm: ZennFrontmatter): string {
  const lines: string[] = ["---"];
  lines.push(`title: ${yamlString(fm.title)}`);
  lines.push(`emoji: ${yamlString(fm.emoji)}`);
  lines.push(`type: ${fm.type}`);
  lines.push(`topics: [${fm.topics.map((t) => yamlString(t)).join(", ")}]`);
  lines.push(`published: ${fm.published}`);
  if (fm.publication_name) {
    lines.push(`publication_name: ${yamlString(fm.publication_name)}`);
  }
  lines.push("---");
  return lines.join("\n");
}

/**
 * `"..."` 形式に escape して quote。double-quote / backslash は escape する。
 *
 * @graph-connects none
 */
function yamlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
