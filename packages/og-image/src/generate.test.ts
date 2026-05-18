/**
 * renderOgImage の integration テスト。実 font を渡して satori + resvg を回し、
 * 1200x630 PNG buffer が返ることを確認する。font は jsdelivr から jit fetch して
 * test 内で cache する (テスト初回のみ network、CI 2 回目以降は disk から)。
 *
 * 重い test なので JP / EN 各 1 ケースに留め、template の細かい branch は
 * `og-template.test.ts` の VNode walk で押さえる役割分担。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business renderOgImage の integration test。実 font を渡して satori + resvg pipeline を回し、PNG signature と寸法を assert する
 * @graph-connects none
 */

import { readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { renderOgImage, renderSiteOgImage } from "./generate.js";

const CACHE_DIR = resolve(tmpdir(), "og-image-test-cache");

async function fetchCached(url: string, key: string): Promise<ArrayBuffer> {
  const p = resolve(CACHE_DIR, key);
  try {
    await stat(p);
    const buf = await readFile(p);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  } catch {
    // cache miss
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed: ${url}`);
  const ab = await res.arrayBuffer();
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, Buffer.from(ab));
  return ab;
}

async function loadFonts(): Promise<{ serif: ArrayBuffer; sans: ArrayBuffer }> {
  const [serif, sans] = await Promise.all([
    fetchCached(
      "https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-jp@5/files/noto-serif-jp-japanese-700-normal.woff",
      "noto-serif-jp.woff",
    ),
    fetchCached(
      "https://cdn.jsdelivr.net/npm/@fontsource/inter@5/files/inter-latin-500-normal.woff",
      "inter.woff",
    ),
  ]);
  return { serif, sans };
}

/** PNG signature の最初の 8 byte: `89 50 4E 47 0D 0A 1A 0A`。 */
function isPng(buf: Buffer): boolean {
  return (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  );
}

/** PNG IHDR (byte 16..24) から width/height を読む。 */
function pngDims(buf: Buffer): { width: number; height: number } {
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

describe("renderOgImage", () => {
  it("EN タイトルで 1200x630 PNG を返す", async () => {
    const fonts = await loadFonts();
    const png = await renderOgImage({ lang: "en", title: "Hello", fonts });
    expect(isPng(png)).toBe(true);
    expect(pngDims(png)).toStrictEqual({ width: 1200, height: 630 });
  });

  it("JP (multi-byte) タイトルでも同じく 1200x630 PNG を返す", async () => {
    const fonts = await loadFonts();
    const png = await renderOgImage({ lang: "ja", title: "テスト記事", fonts });
    expect(isPng(png)).toBe(true);
    expect(pngDims(png)).toStrictEqual({ width: 1200, height: 630 });
  });
});

describe("renderSiteOgImage", () => {
  it("site default (`public/og-image.png` 用) も 1200x630 PNG を返す", async () => {
    const fonts = await loadFonts();
    const png = await renderSiteOgImage(fonts);
    expect(isPng(png)).toBe(true);
    expect(pngDims(png)).toStrictEqual({ width: 1200, height: 630 });
  });
});
