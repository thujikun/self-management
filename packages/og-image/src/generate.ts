/**
 * og:image 生成の core。共通テンプレート (OgTemplate) を satori で SVG にして resvg で PNG。
 *
 * `OgFonts` は呼び出し側 (CLI) が ArrayBuffer で渡す。font 取得 (download / cache)
 * は本 module の責務外で、I/O を pure module に持ち込まない。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business og:image 生成の core 関数。JP/EN 共通テンプレートで satori + resvg を回し 1200x630 PNG buffer を返す。font 読み込みは I/O なので呼び出し側に委ねる
 * @graph-connects og-image [calls] satori (VNode → SVG)、@resvg/resvg-js (SVG → PNG)
 */

import { Resvg } from "@resvg/resvg-js";
import satori from "satori";

import { OgTemplate } from "./templates/og-template.js";
import { SiteOgTemplate } from "./templates/site-og-template.js";

/** @graph-connects none */
export type OgLang = "ja" | "en";

/** @graph-connects none */
export interface OgFonts {
  /** serif (本文タイトル用)。.otf / .ttf / .woff binary */
  serif: ArrayBuffer;
  /** sans-serif (footer 用 / アクセント)。.otf / .ttf / .woff binary */
  sans: ArrayBuffer;
}

/** @graph-connects none */
export interface OgImageInput {
  /**
   * 出力 lang。現状テンプレートは lang 非依存だが、将来 JP-only / EN-only な
   * 切替を入れる時のために interface には残す (frontmatter ↔ generator の wiring 用)。
   */
  lang: OgLang;
  title: string;
  fonts: OgFonts;
}

/**
 * og:image を 1200x630 PNG として render。
 *
 * @graph-connects og-image [calls] OgTemplate
 */
export async function renderOgImage(input: OgImageInput): Promise<Buffer> {
  const node = OgTemplate({ title: input.title });
  return await renderNodeToPng(node, input.fonts);
}

/**
 * site default の og:image (`public/og-image.png`) を 1200x630 PNG として render。
 *
 * @graph-connects og-image [calls] SiteOgTemplate
 */
export async function renderSiteOgImage(fonts: OgFonts): Promise<Buffer> {
  return await renderNodeToPng(SiteOgTemplate(), fonts);
}

/** @graph-connects og-image [calls] satori → resvg pipeline */
async function renderNodeToPng(node: unknown, fonts: OgFonts): Promise<Buffer> {
  // satori の型は React element を要求するが、構造的には `{ type, props }` shape
  // (= 本 package の VNode) で動く。型 narrowing のため satori 側型に合わせて cast。
  const svg = await satori(node as Parameters<typeof satori>[0], {
    width: 1200,
    height: 630,
    fonts: [
      { name: "serif", data: fonts.serif, weight: 700, style: "normal" },
      { name: "sans", data: fonts.sans, weight: 500, style: "normal" },
    ],
  });

  const png = new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng();
  return Buffer.from(png);
}
