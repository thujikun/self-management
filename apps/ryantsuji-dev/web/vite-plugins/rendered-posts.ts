/**
 * Vite plugin: `content/posts/*.{en,ja}.md` を build-time に renderMarkdown して
 * `virtual:rendered-posts` 仮想 module として export する。
 *
 * 動機: runtime (CF Workers) で shiki / unified を回すと、長い記事 (17 min read 等)
 * で Worker の CPU 上限 (Free plan は 10ms) を超え Error 1102 で落ちる。markdown は
 * deploy 間で変化しない static asset なので、build 時に 1 回 render して JSON にして
 * しまえば runtime は lookup のみで CPU 消費ほぼゼロ。shiki も Worker bundle から
 * 完全に外れる (bundle size も追加削減)。
 *
 * 設計:
 * - dev / build 両方で同 module を提供。dev 時の hot reload は `configureServer` で
 *   `content/posts/` を watch、変更時に該当 module を invalidate して再 load
 * - 1 file 1 entry の単一 JSON。post 数が 16 件レベルなので合計 sub-MB に収まる
 * - 値は `RenderedDoc` (html / frontmatter / headings / readingTimeMinutes) を
 *   そのまま JSON serialize。serializable な構造に既になっている
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business `virtual:rendered-posts` 仮想 module を提供する Vite plugin。content/posts の .md を build 時に renderMarkdown してから JSON 化し、Worker runtime からは lookup のみで使えるようにする。shiki を Worker bundle から外し CPU 上限と bundle size 両方を解消
 * @graph-connects content [calls] @self/content の renderMarkdown を build host (Node) で実行
 * @graph-connects cloudflare [provides] runtime に渡る pre-rendered HTML (shiki を Worker bundle に含めない)
 */

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { renderMarkdown, type RenderedDoc } from "@self/content";
import type { Plugin } from "vite";

/** @graph-connects none */
const VIRTUAL_ID = "virtual:rendered-posts";
/** @graph-connects none */
const RESOLVED_VIRTUAL_ID = "\0" + VIRTUAL_ID;

/**
 * `content/posts/` 配下の全 markdown を渡された path で pre-render してから
 * filename → RenderedDoc の Map を返す pure ish helper (I/O は readFile / readdir
 * のみ、renderMarkdown 自体は pure)。
 *
 * @graph-connects content [calls] renderMarkdown
 */
export async function renderAllPosts(postsDir: string): Promise<Record<string, RenderedDoc>> {
  // readdir は OS / FS 依存の順序で返るため、insertion order がそのまま JSON.stringify
  // の文字列順に乗らないように事前 sort。reproducible build (同 commit を mac / linux で
  // build した時の worker-entry hash 一致) を保つための決定性確保。
  const files = (await readdir(postsDir)).sort();
  const out: Record<string, RenderedDoc> = {};
  for (const f of files) {
    if (!f.endsWith(".md")) continue;
    const source = await readFile(resolve(postsDir, f), "utf8");
    out[f] = await renderMarkdown(source);
  }
  return out;
}

/**
 * `virtual:rendered-posts` 仮想 module を提供する Vite plugin。
 *
 * @param postsDirAbs `content/posts/` の絶対 path
 * @graph-connects none
 */
export function renderedPostsPlugin(postsDirAbs: string): Plugin {
  return {
    name: "rendered-posts",
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_VIRTUAL_ID;
      return null;
    },
    async load(id) {
      if (id !== RESOLVED_VIRTUAL_ID) return null;
      const rendered = await renderAllPosts(postsDirAbs);
      // RenderedDoc は JSON-serializable (string / number / 配列 / Frontmatter object のみ)。
      // export 形は `posts.ts` 側で読み込みやすいよう default export ではなく named。
      return `export const renderedPosts = ${JSON.stringify(rendered)};`;
    },
    configureServer(server) {
      // dev: content/posts の .md 変更時に該当 virtual module を invalidate、HMR で
      // 反映する。Hot reload で frontmatter / 本文どちらの変更も拾えるよう、watcher を
      // `add` / `change` / `unlink` 全部 hook する。
      const trigger = () => {
        const mod = server.moduleGraph.getModuleById(RESOLVED_VIRTUAL_ID);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: "full-reload" });
      };
      server.watcher.add(postsDirAbs);
      server.watcher.on("change", (p) => {
        if (p.startsWith(postsDirAbs) && p.endsWith(".md")) trigger();
      });
      server.watcher.on("add", (p) => {
        if (p.startsWith(postsDirAbs) && p.endsWith(".md")) trigger();
      });
      server.watcher.on("unlink", (p) => {
        if (p.startsWith(postsDirAbs) && p.endsWith(".md")) trigger();
      });
    },
  };
}
