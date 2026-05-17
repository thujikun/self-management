/**
 * Vite plugin (`vite-plugins/rendered-posts.ts`) が提供する仮想 module の TypeScript
 * 宣言。`virtual:rendered-posts` の `renderedPosts` を `Record<string, RenderedDoc>`
 * として import できる形に型付けする。
 *
 * 適切な ambient 宣言で type narrowing するため、global declaration として持つ。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business Vite 仮想 module の type augmentation。virtual:rendered-posts の export shape を Record<filename, RenderedDoc> に narrow して、posts.ts が型安全に lookup できるようにする
 * @graph-connects none
 */

declare module "virtual:rendered-posts" {
  import type { RenderedDoc } from "@self/content";
  /** filename (`<slug>.<lang>.md`) → 該当 markdown を build 時に renderMarkdown した結果。 */
  export const renderedPosts: Record<string, RenderedDoc>;
}
