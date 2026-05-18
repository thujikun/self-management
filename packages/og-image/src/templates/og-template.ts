/**
 * og:image テンプレート (lang 共通)。dark brand 横長 layout で、`rt` ロゴを上、
 * 大きな serif title を中央、tagline + tiffany-teal accent を下に置く。背景には
 * site の ambient blob と同じ 2 つの teal glow (左上 + 右下) を radial-gradient
 * で配置し、サイトと UI 体験を揃える。
 *
 * 当初は JP を Zenn 風 (絵文字 + 縦書き light BG) にしていたが、EN と統一して
 * brand 一貫性を取る方針に切替えた (2026-05-16)。serif 用 font は Noto Serif JP
 * を使うので JP/ASCII 両方覆える。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business JP/EN 共通の og:image テンプレート。rt logo + 中央 serif title + footer tagline、tiffany-teal アクセントの dark 横長 layout。背景 ambient blob (左上 + 右下) をサイト本体と揃え、SNS 共有時にもブランド体験を一貫させる。serif は Noto Serif JP で JP/ASCII 両対応
 * @graph-connects og-image [calls] h() factory で satori VNode を組む
 */

import { h, type VNode } from "./h.js";

/** @graph-connects none */
const BRAND_TEAL = "#0abab5";
/** @graph-connects none */
const BRAND_TEAL_LIGHT = "#39c4bf";
/** @graph-connects none */
const TEXT_PRIMARY = "#f7f8f9";
/** @graph-connects none */
const TEXT_MUTED = "#a3a8af";
/** @graph-connects none */
const BG_BASE = "#0c1417";

/** @graph-connects og-image [calls] h() factory */
export function OgTemplate({ title }: { title: string }): VNode {
  return h(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: BG_BASE,
        padding: "96px",
        position: "relative",
      },
    },
    // site の ambient blob を再現: 左上 (accent-bg) + 右下 (accent-border light)。
    // satori は filter:blur が unstable なので radial-gradient で soft glow を表現する。
    h("div", {
      style: {
        position: "absolute",
        top: -360,
        left: -360,
        width: 1080,
        height: 1080,
        backgroundImage: `radial-gradient(closest-side, ${BRAND_TEAL} 0%, transparent 70%)`,
        opacity: 0.45,
      },
    }),
    h("div", {
      style: {
        position: "absolute",
        bottom: -300,
        right: -300,
        width: 900,
        height: 900,
        backgroundImage: `radial-gradient(closest-side, ${BRAND_TEAL_LIGHT} 0%, transparent 70%)`,
        opacity: 0.32,
      },
    }),
    // 上段: rt logo (テキスト)
    h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 18,
        },
      },
      h(
        "div",
        {
          style: {
            fontFamily: "sans",
            fontSize: 56,
            fontWeight: 700,
            color: BRAND_TEAL,
            letterSpacing: "-0.04em",
          },
        },
        "rt",
      ),
      h(
        "div",
        {
          style: {
            fontFamily: "sans",
            fontSize: 28,
            color: TEXT_MUTED,
            letterSpacing: "0.02em",
          },
        },
        "ryantsuji.dev",
      ),
    ),
    // 中央: title
    h(
      "div",
      {
        style: {
          flex: 1,
          display: "flex",
          alignItems: "center",
          marginTop: 24,
        },
      },
      h(
        "div",
        {
          style: {
            fontFamily: "serif",
            fontSize: 64,
            lineHeight: 1.25,
            color: TEXT_PRIMARY,
            letterSpacing: "-0.015em",
          },
        },
        title,
      ),
    ),
    // 下段: tagline
    h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 16,
        },
      },
      h("div", {
        style: {
          width: 4,
          height: 40,
          backgroundColor: BRAND_TEAL,
          borderRadius: 2,
        },
      }),
      h(
        "div",
        {
          style: {
            fontFamily: "sans",
            fontSize: 24,
            color: TEXT_MUTED,
            letterSpacing: "0.04em",
          },
        },
        "engineering / design / product",
      ),
    ),
  );
}
