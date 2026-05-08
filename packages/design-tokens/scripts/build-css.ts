/**
 * `pnpm build` から呼ばれる CLI: src/css.ts の buildCss() を dist/tokens.css に書き出す。
 *
 * pure logic は src/css.ts 側に持ち、ここは I/O だけ。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business design tokens の build entry。dist/ ディレクトリを mkdir し、buildCss() の出力を tokens.css に書き出すだけの薄い wrapper。逻辑は src/css.ts に集約され本ファイルは I/O のみ
 * @graph-connects design-tokens [calls] buildCss() を呼んで dist/tokens.css を生成
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildCss } from "../src/css.js";

/** @graph-connects none */
const here = dirname(fileURLToPath(import.meta.url));
/** @graph-connects none */
const distDir = join(here, "..", "dist");
mkdirSync(distDir, { recursive: true });
/** @graph-connects none */
const out = join(distDir, "tokens.css");
writeFileSync(out, buildCss(), "utf8");
console.log(`wrote ${out}`);
