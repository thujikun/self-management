/**
 * `/` (landing page) のユニット test。
 *
 * Route export と placeholder copy ("coming soon" と syndication 行) を SSR で網羅。
 * router context が要らない範囲なので、`renderToString` で IndexPage を直接 render する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business landing route の placeholder copy が壊れていないことを SSR で保証。Phase 1 (design discovery) 後の本実装に置き換わるまでの一時 guard。Route export 自体も object として存在することを確認
 * @graph-connects none
 */

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Route } from "./index.js";

describe("/ — landing page", () => {
  it("Route export は object として実体化されている", () => {
    expect(Route).toBeTypeOf("object");
    expect(Route).not.toBeNull();
  });

  it("IndexPage SSR が placeholder コピーを含む", () => {
    const Component = Route.options.component;
    if (!Component) throw new Error("Route.options.component is undefined");
    const html = renderToString(<Component />);
    expect(html).toContain("ryantsuji.dev");
    expect(html).toContain("coming soon");
    expect(html).toContain("zenn.dev/ryantsuji");
    expect(html).toContain("dev.to/ryantsuji");
  });
});
