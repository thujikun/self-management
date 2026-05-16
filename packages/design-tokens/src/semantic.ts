/**
 * Semantic design tokens — UI 文脈別 alias。
 *
 * primitive に直接触らず semantic だけを参照する規約で、theming 切替 (light/dark)
 * を 1 箇所で吸収する。component 側は `bg.surface` / `text.primary` 等の
 * 意味のある名前で書く (= `gray.50` / `gray.900` という physical name は隠す)。
 *
 * light / dark の値は同一 token name で異なる primitive にマップする。
 * `prefers-color-scheme: dark` で一括切替。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business semantic token layer。bg / text / border / accent の 4 系統 × light/dark 2 mode。component 側は semantic name で書き、theming 切替を 1 箇所で吸収できる構造を保証する
 * @graph-connects none
 */

import { accent, blur, gray } from "./primitive.js";

/**
 * semantic token の意味的 key (light/dark で同じ集合)。
 *
 * @graph-connects none
 */
export interface SemanticTokens {
  bg: {
    /** ページ全体の base */
    base: string;
    /** card や code block 等、surface より一段持ち上がった面 */
    surface: string;
    /** さらに上、popover / hover state 等 */
    elevated: string;
  };
  text: {
    /** 本文 / heading の主色 */
    primary: string;
    /** caption / meta info 等の副色 */
    secondary: string;
    /** disabled / hint */
    muted: string;
    /** accent text (link 等) */
    accent: string;
  };
  border: {
    /** divider / hairline */
    subtle: string;
    /** input border / card border */
    default: string;
    /** focus ring 等の強調 */
    strong: string;
  };
  accent: {
    /** accent fill (button bg 等) */
    bg: string;
    /** accent fill 上の text */
    fg: string;
    /** accent border / focus ring */
    border: string;
  };
  /**
   * glass morphism — sticky header / floating panel / modal overlay 用。
   *
   * 使い方: `background: glass.bg; backdrop-filter: blur(glass.blur);
   * border: 1px solid glass.border;` を一式で適用する。`bg` は半透明色なので、
   * 背後にコンテンツがあって初めて効果が出る (純粋な surface なら通常の bg を使う)。
   */
  glass: {
    /** 半透明 background (backdrop-filter と組み合わせる) */
    bg: string;
    /** glass surface に乗せる border (低 alpha highlight) */
    border: string;
    /** backdrop-filter に渡す blur radius */
    blur: string;
  };
}

/**
 * light theme semantic mapping。
 *
 * @graph-connects none
 */
export const light: SemanticTokens = {
  bg: {
    base: gray[0],
    surface: gray[50],
    elevated: gray[100],
  },
  text: {
    primary: gray[900],
    secondary: gray[700],
    muted: gray[500],
    accent: accent[700],
  },
  border: {
    subtle: gray[100],
    default: gray[200],
    strong: gray[400],
  },
  accent: {
    bg: accent[600],
    fg: gray[0],
    border: accent[500],
  },
  // light: 白系 surface にしっかりフロスト。bg は中程度 alpha でガラス感を強める
  // (alpha 0.65 だと不透明すぎて blur 効果が見えなくなるため 0.45 まで下げた)。
  // blur は xl (24px) で背後コンテンツが明確にボケる強さに。
  glass: {
    bg: "oklch(100% 0 0 / 0.45)",
    border: "oklch(0% 0 0 / 0.06)",
    blur: blur.xl,
  },
};

/**
 * dark theme semantic mapping。primitive を反転 + brand 色温度 (teal 188) を弱く乗せる。
 *
 * 純黒 (`gray[900]` = oklch(14% 0 0)) は背景に重みがありすぎて glass morphism の
 * 半透明 layer が映えないため、bg base / surface / elevated に **brand chroma 0.01-0.02
 * のみ**乗せ、ガラス越しに見える色温度を統一する。accessibility 上の contrast は
 * 元の gray scale と同等を維持。
 *
 * @graph-connects none
 */
export const dark: SemanticTokens = {
  bg: {
    base: "oklch(17% 0.018 188)", // 純黒回避、極弱 teal tint
    surface: "oklch(22% 0.014 188)",
    elevated: "oklch(28% 0.01 188)",
  },
  text: {
    primary: gray[50],
    secondary: gray[200],
    muted: gray[400],
    accent: accent[300],
  },
  border: {
    subtle: "oklch(22% 0.014 188)",
    default: "oklch(30% 0.012 188)",
    strong: gray[500],
  },
  accent: {
    bg: accent[500],
    fg: gray[900],
    border: accent[400],
  },
  // dark: 半透明な brand tint + 白系低 alpha highlight。light と同じ理由で
  // alpha を 0.55 → 0.4 に下げ、blur radius を xl に。
  glass: {
    bg: "oklch(22% 0.02 188 / 0.4)",
    border: "oklch(100% 0 0 / 0.08)",
    blur: blur.xl,
  },
};
