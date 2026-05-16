/**
 * satori 互換の minimal element factory。React や JSX runtime に依存せず、
 * `{ type, props: { children, ...rest } }` という satori が期待する shape を直接組む。
 *
 * tsx (script runner) のデフォルト JSX 変換が classic (React.createElement 前提) で
 * あり、`jsx: "react-jsx"` を root tsconfig で固定できる状況にもないため、本 package
 * は JSX を使わず h() factory に統一する。これにより consumer 側の tsconfig / runner
 * 設定に関係なく動く。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business satori 用の element factory。JSX 不使用で `{ type, props: { children, ... } }` shape を直接返す。tsx 等の runner の JSX 設定差異を回避し、og-image package の portability を確保する
 * @graph-connects none
 */

/**
 * satori が読む VNode 型。CSS 風 style は React 標準の object form を採用。
 *
 * @graph-connects none
 */
export interface VNode {
  type: string;
  props: {
    style?: Record<string, string | number | undefined>;
    children?: VNode | string | (VNode | string)[];
  };
}

/**
 * satori が読み込める VNode を返す factory。`type` は `div` / `span` 等の string、
 * `props.style` は React 流の camelCase style object、`children` は string か VNode、
 * またはそれらの配列。
 *
 * @graph-connects none
 */
export function h(
  type: string,
  props: { style?: Record<string, string | number | undefined> } | null,
  ...children: (VNode | string | null | undefined | false)[]
): VNode {
  const flat = children
    .flat(Infinity as 1)
    .filter((c): c is VNode | string => c !== null && c !== undefined && c !== false);
  return {
    type,
    props: {
      style: props?.style,
      children: flat.length === 0 ? undefined : flat.length === 1 ? flat[0] : flat,
    },
  };
}
