/**
 * engagement (likes / comments) 周辺の **pure** 入力 validation / 正規化を集約。
 *
 * DB を叩かない関数だけここに置き、`engagement.ts` (real DB ops) は実 query を担当する
 * 構造に分ける。これで pure 部分を per-file 90% カバレッジで網羅テストでき、DB ops 側は
 * 統合 test (route + 実 DB 等) で担保する分離。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business comments / likes 入力の正規化と上限 check を集約した pure 層。route 側 createServerFn handler から「先に validate → 通れば db 層へ」の流れに乗せ、DB 層を薄く保つ
 * @graph-connects none
 */

/** 1 comment あたりの本文上限 (chars)。@graph-connects none */
export const COMMENT_BODY_MAX = 4000;

/**
 * comment body を trim + 長さ check。空 / 上限超 で `Error("INVALID_COMMENT_BODY: ...")` を
 * throw する。通れば trim 済 string を返す。
 *
 * @graph-connects none
 */
export function validateCommentBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    throw new Error("INVALID_COMMENT_BODY: empty");
  }
  if (trimmed.length > COMMENT_BODY_MAX) {
    throw new Error(`INVALID_COMMENT_BODY: max ${COMMENT_BODY_MAX} chars`);
  }
  return trimmed;
}

/**
 * `comments.createdAt` の DB 値を ISO 文字列に正規化。Drizzle/Neon HTTP は driver 設定で
 * Date を返す経路と string を返す経路があるため、UI に渡す前に常に string に揃える。
 *
 * @graph-connects none
 */
export function normalizeTimestamp(value: Date | string | null | undefined): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
