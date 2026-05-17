/**
 * `/images/*` route の R2 serving logic。
 *
 * Worker entry (`src/server.ts`) の fetch handler から TanStack Start に流す前に
 * intercept される。`new URL(req.url).pathname` が `/images/` 配下なら R2 bucket
 * (`env.IMAGES`) を直接引いて Response を返す。
 *
 * **設計上の決め事**:
 * - **immutable cache**: 画像 URL は markdown 内で fingerprinted path (`/images/posts/<slug>/<name>.png`)
 *   として参照されるので、`Cache-Control: public, max-age=31536000, immutable` を強く付ける。
 *   同名ファイルの内容更新は CI sync 時に新 etag になり CF edge cache が invalidate される。
 * - **404 は plain text**: HTML を返すと post page の見た目を真似た 404 fallback が
 *   走るので、image 経路は `text/plain` で簡素に。
 * - **HEAD support**: og:image / crawler は HEAD を投げてくることがあるため body 無しで
 *   etag / content-length / content-type だけ返せるようにする。
 *
 * pure function に切出して test 容易性を確保 (`R2Bucket` interface を渡すだけで動く)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business `/images/*` request を R2 bucket `IMAGES` から serve する。immutable
 * 長期キャッシュ + HEAD 対応 + 404 plain で post 添付画像配信を成立させる。Worker entry
 * から intercept される前段 routing として TanStack Start handler に届く前に終端する
 * @graph-connects cloudflare-r2 [reads_from] env.IMAGES.get / head で object を fetch
 */

/**
 * `/images/` prefix を pathname から剥がして R2 key を組む。先頭 `/` も除去する。
 * decode しない理由: R2 key は raw byte path で保持される運用 (CI sync 側で encode
 * しないため)、reuests 側も encode していない想定。markdown image src も同様。
 *
 * @graph-connects none
 */
export function r2KeyFromPath(pathname: string): string | null {
  const prefix = "/images/";
  if (!pathname.startsWith(prefix)) return null;
  const key = pathname.slice(prefix.length);
  if (key.length === 0) return null;
  // path traversal 防止 + sentinel 露出防止:
  // - `..` / `.` segment: 絶対 path や parent traversal を弾く (R2 は flat key だが
  //   `/images/../secrets` 等の意図しない解釈を排除)
  // - `/` 始まり: 絶対 path 形式の key は dev 側で `resolve(imagesDir, key)` を
  //   override して dir 外に脱出するので弾く (dev/prod 規則を揃える)
  // - `_` / `.` 始まり segment: bucket 内の sentinel object (`_manifest.json` 等) と
  //   hidden file を配信から完全に隠す。`/images/_manifest.json` で sha256 manifest が
  //   public に漏れるのを構造的に防ぐ
  if (key.startsWith("/")) return null;
  if (
    key
      .split("/")
      .some((seg) => seg === ".." || seg === "." || seg.startsWith("_") || seg.startsWith("."))
  ) {
    return null;
  }
  return key;
}

/**
 * `R2Bucket` の subset interface。test では Map-backed fake で差替える。`@cloudflare/workers-types`
 * の `R2Bucket` を直接参照しないことで、runtime に CF Workers global を要求しない。
 *
 * @graph-connects none
 */
export interface R2BucketLike {
  get(key: string): Promise<R2ObjectLike | null>;
  head(key: string): Promise<R2ObjectLike | null>;
}

/** @graph-connects none */
export interface R2ObjectLike {
  body: ReadableStream | null;
  httpEtag: string;
  size: number;
  httpMetadata?: { contentType?: string } | undefined;
  writeHttpMetadata(headers: Headers): void;
}

/**
 * Cache-Control header の値。immutable + 1 年。markdown が同名 path を上書きする時は
 * 内容変更で etag が変わるので、CF edge cache は次回 fetch で revalidate して新版に
 * 切替わる (immutable は browser 側に対する宣言なので edge には影響しない)。
 *
 * @graph-connects none
 */
export const IMAGE_CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * Request method + R2 lookup から Response を組む pure 関数。
 *
 * 戻り値:
 * - GET / HEAD 以外 → 405
 * - key が `/images/..` を含む / 空 → 404
 * - R2 に object 無し → 404 (text/plain)
 * - HEAD → status 200 + Content-Type / Content-Length / ETag / Cache-Control の header
 * - GET → 上記 + R2 body stream
 *
 * @graph-connects cloudflare-r2 [reads_from] bucket.get / head
 */
export async function serveImage(
  bucket: R2BucketLike,
  request: { method: string; url: string },
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("method not allowed", { status: 405 });
  }

  const url = new URL(request.url);
  const key = r2KeyFromPath(url.pathname);
  if (key === null) {
    return new Response("not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const object = request.method === "HEAD" ? await bucket.head(key) : await bucket.get(key);
  if (!object) {
    return new Response("not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", IMAGE_CACHE_CONTROL);
  // Content-Length は R2 object metadata に乗ってないことがあるので size で補う。
  headers.set("Content-Length", String(object.size));
  // `writeHttpMetadata` が Content-Type を set しなかった = R2 object metadata 欠落
  // (sync 側で必ず put 時に content-type を渡す前提だが defensive に generic で埋める)。
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/octet-stream");
  }

  return new Response(request.method === "HEAD" ? null : object.body, {
    status: 200,
    headers,
  });
}
