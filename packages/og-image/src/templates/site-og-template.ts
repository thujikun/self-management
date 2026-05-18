/**
 * site default の og:image テンプレート (= `public/og-image.png`)。
 * post 用の `OgTemplate` と同じ dark base + ambient blob を使いつつ、中央は
 * 巨大な `rt` ロゴ + サブ tagline に振り、SNS で「サイト全体」をシェアした時に
 * 「個別 post」 と区別がつくよう brand-forward な構図にする。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business `public/og-image.png` の生成テンプレート。OgTemplate と同じ dark base + ambient blob を共有しつつ、中央を巨大な rt ロゴ + ryantsuji.dev に置換して個別 post の cover との視覚的差別化を保つ
 * @graph-connects og-image [calls] h() factory で satori VNode を組む
 */

import { h, type VNode } from "./h.js";

/** @graph-connects none */
const BRAND_TEAL = "#0abab5";
/** @graph-connects none */
const BRAND_TEAL_LIGHT = "#39c4bf";
/** @graph-connects none */
const TEXT_MUTED = "#a3a8af";
/** @graph-connects none */
const BG_BASE = "#0c1417";

/** @graph-connects og-image [calls] h() factory */
export function SiteOgTemplate(): VNode {
  return h(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: BG_BASE,
        padding: "96px 96px 56px 96px",
        position: "relative",
        alignItems: "center",
        justifyContent: "center",
      },
    },
    // OgTemplate と同じ 2 つの ambient blob
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
    // 中央: 巨大な rt ロゴ
    h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
        },
      },
      h(
        "div",
        {
          style: {
            fontFamily: "sans",
            fontSize: 280,
            fontWeight: 700,
            color: BRAND_TEAL,
            letterSpacing: "-0.05em",
            lineHeight: 1,
          },
        },
        "rt",
      ),
      h(
        "div",
        {
          style: {
            fontFamily: "sans",
            fontSize: 44,
            color: TEXT_MUTED,
            letterSpacing: "0.04em",
          },
        },
        "ryantsuji.dev",
      ),
    ),
    // 下段: tagline (post 用と揃える)
    h(
      "div",
      {
        style: {
          position: "absolute",
          left: 96,
          bottom: 56,
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
