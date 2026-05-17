/**
 * Zenn 互換の `:::message` / `:::message alert` directive を ryantsuji.dev の
 * remark pipeline で `<aside>` HTML に変換する pure helper 群。
 *
 * Zenn の markdown 拡張: container directive 形式の callout を 2 種類提供する:
 * ```md
 * :::message
 * 情報メモ (info / note)
 * :::
 *
 * :::message alert
 * 警告 / 注意 (warning / alert)
 * :::
 * ```
 *
 * **Zenn 構文 vs remark-directive 標準構文**:
 * remark-directive (CommonMark Directives) の標準は `:::name[label]{attrs}` 形式
 * で、`:::message alert` のような **空白区切りの positional 名指し** は仕様外。
 * そのため source の `:::message alert` を **そのまま** unified pipeline に流すと、
 * directive parser が name="message" + 後続 "alert" を持て余して fallback path で
 * raw paragraph に倒れ、結果として `:::message alert` の literal 行が表示される。
 *
 * 解決策として、**unified pipeline の前** に `normalizeZennMessageAlert` で
 * `:::message alert` → `:::message-alert` に 1 行 rewrite して標準構文に揃え、
 * その後 `remarkDirectiveCallouts` で `message` / `message-alert` の 2 種類を
 * `<aside class="callout callout-{info|alert}">` に hName/hProperties を割り当て
 * る形にした。CSS 側で `.callout-info` / `.callout-alert` の見た目を当てる。
 *
 * source markdown 自体は **Zenn と完全互換のまま** 保てる (= 別途 syndicate
 * pipeline で書き換え不要)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business Zenn 互換の `:::message` / `:::message alert` を ryantsuji.dev の unified pipeline で `<aside class="callout callout-{info|alert}">` に変換する pure helper。source は Zenn 構文のまま保てるので別途 syndicate 側で書き換え不要
 * @graph-connects unified [calls] remark-directive 経由で containerDirective ノードを hast `<aside>` に hName/hProperties で割り当て
 */

import type { Plugin } from "unified";
import type { Root } from "mdast";
import { visit } from "unist-util-visit";

/**
 * Zenn 構文 (`:::message alert`) を CommonMark Directives 標準構文に近づける
 * `:::message-alert` に 1 行 rewrite する pure 文字列変換。
 *
 * 対象は **行頭の `:::message alert`** のみ (前後空白許容、本文中の偶発的な
 * `:::message alert` 文字列は触らない)。閉じ `:::` 行は変えない。
 *
 * @graph-connects none
 */
export function normalizeZennMessageAlert(source: string): string {
  // 行頭 `:::message alert` (前置空白なし) + 行末空白許容を `:::message-alert` に置換。
  // 前置空白を許容しないのは、remark-directive 自身が column 0 のみを directive 行
  // として認識するため (= 4-space indent / code fence 内の `:::message alert` は
  // markdown 仕様上 directive にならない、ので元の literal のまま残す)。
  return source.replace(/^:::message[ \t]+alert[ \t]*$/gmu, ":::message-alert");
}

/**
 * `remark-directive` で parse された containerDirective ノードのうち、
 * Zenn 互換の `message` / `message-alert` を `<aside class="callout callout-{...}">`
 * に変換する remark plugin。
 *
 * 他の名前の containerDirective (= 将来 `:::details` 等を入れたい時) は触らない
 * ので、追加時はここに 1 case 足すだけで OK。
 *
 * @graph-connects unist-util-visit [calls] containerDirective ノードを訪問し data.hName/hProperties を上書き
 */
export const remarkDirectiveCallouts: Plugin<[], Root> = () => (tree) => {
  visit(tree, "containerDirective", (node) => {
    const variant = MESSAGE_VARIANTS[node.name];
    if (!variant) return;
    const data = node.data ?? (node.data = {});
    data.hName = "aside";
    data.hProperties = {
      className: ["callout", `callout-${variant}`],
    };
  });
};

/** @graph-connects none */
const MESSAGE_VARIANTS: Record<string, "info" | "alert"> = {
  message: "info",
  "message-alert": "alert",
};
