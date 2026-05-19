/**
 * 正準ホスト (`https://ryantsuji.dev`) 以外の host / protocol で来た request を
 * 301 で正準 URL に倒す pure 関数。`server.ts` (Worker entry) から呼ばれる。
 *
 * 受理対象:
 * - `ryantsuji.dev` (canonical) — そのまま (戻り値 null)
 * - `www.ryantsuji.dev` — `ryantsuji.dev` に倒す
 * - `http://` で着地した同 host — `https://` に倒す
 *
 * GSC で `http://ryantsuji.dev/` / `http://www.ryantsuji.dev/` / `https://www.ryantsuji.dev/`
 * が canonical 重複として警告されるのを構造的に解消する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 正準ホスト以外の host / protocol を 301 で `https://ryantsuji.dev` に倒す pure 関数。Worker entry が任意 host (custom_domain で 2 つ bind) と http スキームの両方を受けるため、SoT を 1 つに集約して GSC の重複 canonical 警告を構造的に消す
 * @graph-connects none
 */

/** @graph-connects none */
export const CANONICAL_HOST = "ryantsuji.dev";

/**
 * request URL が正準形に正規化済なら null、そうでなければ 301 リダイレクト先の
 * 文字列 URL を返す。pathname / search / hash は保持。
 *
 * @graph-connects none
 */
export function canonicalRedirectTarget(requestUrl: string): string | null {
  const url = new URL(requestUrl);
  const isWww = url.hostname === `www.${CANONICAL_HOST}`;
  const isCanonicalHost = url.hostname === CANONICAL_HOST;
  const isHttps = url.protocol === "https:";
  if (isCanonicalHost && isHttps) return null;
  if (!isCanonicalHost && !isWww) return null;
  const next = new URL(url.toString());
  next.protocol = "https:";
  next.hostname = CANONICAL_HOST;
  return next.toString();
}
