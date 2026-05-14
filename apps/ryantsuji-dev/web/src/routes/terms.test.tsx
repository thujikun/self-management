/**
 * `/terms` (terms of service) のユニット test。
 *
 * OAuth provider が要求する Terms of Service URL の実体ページが render され、必須項目
 * (acceptable use / no warranty / governing law / 連絡先) が含まれることを確認する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business terms route の SSR contract 保証。acceptable use 項目 / no warranty / governing law (Japan) / 連絡先 email が壊れていないことを SSR で確認
 * @graph-connects none
 */

import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getRouter } from "../router.js";
import { Route } from "./terms.js";

describe("/terms", () => {
  it("Route の component が TermsPage として登録されている", () => {
    expect(Route.options.component?.name).toStrictEqual("TermsPage");
  });

  it("Terms of Service ページが必須項目を含めて SSR される", async () => {
    const router = getRouter({
      history: createMemoryHistory({ initialEntries: ["/terms"] }),
    });
    await router.load();
    const html = renderToString(<RouterProvider router={router} />);
    expect(html).toMatch(/<h1>Terms of Service<\/h1>/);
    expect(html).toMatch(/Acceptable use/);
    expect(html).toMatch(/No warranty/);
    expect(html).toMatch(/Governing law/);
    expect(html).toMatch(/Japan/);
    expect(html).toMatch(/tsuji\.0107@gmail\.com/);
    expect(html).toMatch(/← back to home/);
  });
});
