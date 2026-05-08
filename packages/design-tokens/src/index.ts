/**
 * `@self/design-tokens` — ryantsuji.dev の design token SSoT。
 *
 * 現状は stub。Phase 1 (design discovery) で次を埋める想定:
 * - color: OKLCH ベースの primitive + semantic (light/dark で同 semantic を解決)
 * - typography: type scale (clamp() ベースの fluid sizing)
 * - spacing / radii / motion / shadow
 * - `tokens.css` (CSS variables) を build 時に export
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business design token の SSoT placeholder。Phase 1 の design discovery で OKLCH / fluid typography / motion / shadow の primitive と semantic 2 層を確立し、light/dark をシングルセマンティック層で解決する設計に倒す
 * @graph-connects none
 */

/** @graph-connects none */
export const TOKEN_VERSION = "0.0.0-stub";
