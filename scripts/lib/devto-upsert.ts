/*
 * devto コメント upsert の順序組立て (pure ロジック層)。
 *
 * `scripts/import-devto-comments.ts` (CLI glue) から切り出した、DB を触らない部分。
 * reply の `parentCommentId` は「トップレベルを先に insert して id を確定させる」
 * 2 パス方式で解決するため、**トップレベルが必ず reply より先に並ぶ** 順序が
 * upsert の正しさの前提になる。その並べ替えをここで固定する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business devto コメント取り込みの upsert 順序組立て。トップレベル先行 (parent id 確定) → reply の 2 パス順序と dry-run 表示行の整形を pure に持ち、DB 書き込み順序の正しさを test 可能にする
 * @graph-connects none
 */

import type { FlatComment } from "./devto-threads.js";

/**
 * upsert する順序に並べ替える: トップレベル (parent 無し) を先頭に、reply を後ろに。
 * それぞれの相対順序 (thread 内の createdAt 昇順) は保つ。reply の parentCommentId
 * 解決は「所属トップレベルが先に insert 済み」であることに依存する。
 *
 * @graph-connects none
 */
export function orderCommentsForUpsert(flats: readonly FlatComment[]): FlatComment[] {
  return [
    ...flats.filter((c) => c.parentSourceId === null),
    ...flats.filter((c) => c.parentSourceId !== null),
  ];
}

/**
 * DRY_RUN 時の表示 1 行を整形する (トップレベル = •、reply = ↳、本文は 60 字まで)。
 *
 * @graph-connects none
 */
export function formatDryRunLine(c: FlatComment): string {
  const bodyHead = c.body.slice(0, 60).replace(/\n/g, " ");
  return `    [dry] ${c.parentSourceId ? "  ↳" : "•"} ${c.authorName} (${c.sourceCommentId}): ${bodyHead}…`;
}
