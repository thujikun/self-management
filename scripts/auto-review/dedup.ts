/**
 * レビュー本文の正規化 + SHA-256 hash。NO_OP 判定で「前回投稿と本質的に同じか」を比較する。
 *
 * 正規化ロジック:
 *   - VERDICT / BODY START/END マーカー除去
 *   - イテレーション表記 (「N 回目」「Round N」「第 N 回」「Iteration N」「イテレーション N」) 除去
 *   - 6 桁以上の連続数字を `<ID>` に
 *   - ISO8601 timestamp を `<TS>` に
 *   - 連続空白を 1 つに圧縮、前後 trim
 * 行番号 (`L854`) や短い数字は保持 (false positive 抑制)。
 */

import { createHash } from "node:crypto";

/** body をレビュー意図のみに正規化する (差分検知のための入力)。 */
export function normalizeBody(body: string): string {
  return body
    .replace(/<!--\s*VERDICT:[A-Z_]+\s*-->/g, "")
    .replace(/<!--\s*AUTO_REVIEW_BODY_(START|END)\s*-->/g, "")
    .replace(
      /(?:\d{1,2}\s*回目|Round\s*\d+|第\s*\d+\s*回|Iteration\s*\d+|イテレーション\s*\d+)/gi,
      "",
    )
    .replace(/(?<![A-Za-z])\d{6,}(?![A-Za-z])/g, "<ID>")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, "<TS>")
    .replace(/\s+/g, " ")
    .trim();
}

/** 正規化済 body の SHA-256 hex hash。 */
export function hashBody(body: string): string {
  return createHash("sha256").update(normalizeBody(body)).digest("hex");
}

/** 2 つの body が「同じレビュー」かを判定する。 */
export function isSameReview(a: string, b: string): boolean {
  return hashBody(a) === hashBody(b);
}
