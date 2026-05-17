/**
 * Vite plugin: dev 時の `/images/*` request を `content/images/` 配下のローカル file
 * から serve する middleware。
 *
 * 役割: prod では Worker entry が R2 binding から `/images/*` を serve する (`server-images.ts`)
 * が、dev (vite) は R2 binding が無いので middleware で local file を直接返す。markdown
 * 内の `![](/images/posts/<slug>/foo.png)` が dev / prod 両方で同一 URL で resolve する
 * よう、prefix / key の解釈は R2 側と完全に揃える (`r2KeyFromPath` 同等の規則を再現)。
 *
 * `public/` に置かない理由:
 * - `public/` 配下のファイルは vite build で client bundle の static asset として
 *   `dist/client/` に copy され、wrangler の `assets.directory` 経由で Worker に
 *   bundle される (= R2 sync しなくても worker で serve できる) が、画像数が増える
 *   と Worker upload 上限 / build artifact size を圧迫する。R2 を真の SSoT に揃え、
 *   `public/` に流さないことで dev/prod の挙動を一致させる。
 *
 * 検出範囲: `/images/<segments>` で `..` / `.` segment や絶対 path (`/etc/...`) は弾く
 * (path traversal 防止)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business dev 時の /images/* 経路を content/images/ ローカル file から serve する vite middleware。R2 binding が dev に無いため Worker route 同等の挙動を local file 経由で再現し、markdown の image URL を dev/prod で 1:1 揃える
 * @graph-connects none
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

import type { Connect, Plugin } from "vite";

/**
 * pathname から R2 key 相当の sub-path を取り出す。`server-images.ts:r2KeyFromPath`
 * と挙動を完全に揃えるため、prefix / traversal の処理は同一規則。
 *
 * @graph-connects none
 */
export function imageKeyFromPath(pathname: string): string | null {
  const prefix = "/images/";
  if (!pathname.startsWith(prefix)) return null;
  const key = pathname.slice(prefix.length);
  if (key.length === 0) return null;
  // 絶対 path 形式の key (`/etc/passwd` 等) は `resolve(imagesDir, key)` を override
  // して dir 外に脱出するので弾く。
  if (key.startsWith("/")) return null;
  if (key.split("/").some((seg) => seg === ".." || seg === ".")) return null;
  return key;
}

/**
 * 拡張子から MIME を解決する素朴な lookup。dev 用途なので image 系の代表的 ext のみ
 * 賄えれば十分。未知 ext は `application/octet-stream` に fallback。
 *
 * @graph-connects none
 */
export function mimeFromExt(ext: string): string {
  const lower = ext.toLowerCase();
  const table: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
  };
  return table[lower] ?? "application/octet-stream";
}

/**
 * Pure な resolution 結果。`filePath` は file が存在し regular file の時のみ非 null。
 * middleware 本体はこの結果を見て res に書く / pipe する分岐を行う。
 *
 * @graph-connects none
 */
export interface ImagesRequestResult {
  status: number;
  headers: Record<string, string>;
  filePath: string | null;
}

/**
 * pure な request handler。fs access (stat) のみ I/O。req / res shape を持たないので
 * unit test 容易性が高い。
 *
 * @graph-connects none
 */
export async function handleImagesRequest(deps: {
  imagesDir: string;
  pathname: string;
  method: string;
}): Promise<ImagesRequestResult> {
  if (deps.method !== "GET" && deps.method !== "HEAD") {
    return {
      status: 405,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      filePath: null,
    };
  }
  const key = imageKeyFromPath(deps.pathname);
  if (key === null) {
    return {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      filePath: null,
    };
  }
  const absPath = join(deps.imagesDir, key);
  try {
    const st = await stat(absPath);
    if (!st.isFile()) {
      return {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        filePath: null,
      };
    }
    return {
      status: 200,
      headers: {
        "Content-Type": mimeFromExt(extname(absPath)),
        "Content-Length": String(st.size),
        // dev では cache 無効化 (markdown image を編集して reload した時に古い版が
        // 返らないようにする)。prod の immutable cache とは別運用。
        "Cache-Control": "no-cache",
      },
      filePath: absPath,
    };
  } catch {
    return {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      filePath: null,
    };
  }
}

/**
 * Connect-style 最小 req/res interface。test では mock object を渡せる shape。
 *
 * @graph-connects none
 */
export interface ImagesMiddlewareReq {
  url?: string;
  method?: string;
}

/** @graph-connects none */
export interface ImagesMiddlewareRes {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(chunk?: string): void;
}

/**
 * 1 request 処理。pipe (GET hit 時の body 配送) は `pipeFile` 関数として注入し、
 * test 時には no-op fake で差替える。fs 例外時は 500 を返して end する。
 *
 * @graph-connects none
 */
export async function processImagesRequest(deps: {
  absDir: string;
  req: ImagesMiddlewareReq;
  res: ImagesMiddlewareRes;
  pipeFile: (filePath: string, res: ImagesMiddlewareRes) => void;
}): Promise<void> {
  const url = deps.req.url ?? "";
  // query string を捨てて pathname だけ取り出す
  const pathname = url.split("?")[0] ?? "";
  try {
    const result = await handleImagesRequest({
      imagesDir: deps.absDir,
      pathname,
      method: deps.req.method ?? "GET",
    });
    deps.res.statusCode = result.status;
    for (const [k, v] of Object.entries(result.headers)) deps.res.setHeader(k, v);
    if (result.filePath && deps.req.method === "GET") {
      deps.pipeFile(result.filePath, deps.res);
    } else {
      deps.res.end(result.status === 200 ? "" : "not found");
    }
  } catch {
    deps.res.statusCode = 500;
    deps.res.end("internal error");
  }
}

/**
 * `processImagesRequest` の I/O wrapper を closure として 1 つ作る。`pipeFile` は実
 * fs read stream を res に pipe する。Connect の req/res 型を ImagesMiddlewareReq/Res
 * に narrow するための structural cast を 1 か所に閉じる。
 *
 * @graph-connects none
 */
export function makeImagesMiddleware(absDir: string): Connect.NextHandleFunction {
  return (req, res, next): void => {
    const url = req.url ?? "";
    if (!url.startsWith("/images/")) {
      next();
      return;
    }
    processImagesRequest({
      absDir,
      req: req as ImagesMiddlewareReq,
      res: res as unknown as ImagesMiddlewareRes,
      pipeFile: (filePath, response): void => {
        createReadStream(filePath).pipe(res);
        void response;
      },
    });
  };
}

/**
 * vite plugin factory。dev server に middleware を install する。build / preview に
 * は影響しない (configureServer のみ)。
 *
 * @graph-connects none
 */
export function localImagesPlugin(imagesDir: string): Plugin {
  const absDir = resolve(imagesDir);
  return {
    name: "ryantsuji-dev:local-images",
    configureServer(server): void {
      server.middlewares.use(makeImagesMiddleware(absDir));
    },
  };
}
