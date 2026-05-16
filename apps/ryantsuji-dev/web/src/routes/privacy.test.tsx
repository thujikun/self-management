/**
 * `/privacy` (privacy policy) のユニット test。
 *
 * OAuth provider が要求する Privacy Policy URL の実体ページが render され、必須項目
 * (連絡先 / 取得 data / third-party 一覧 / 削除手順) が含まれることを確認する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business privacy route の SSR contract 保証。連絡先 email / data collection 説明 / Neon / Cloudflare / GitHub / X の third-party 明示 / 削除手順 が壊れていないことを SSR で確認
 * @graph-connects none
 */

import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getRouter } from "../router.js";
import { Route } from "./privacy.js";

describe("/privacy", () => {
  it("Route の component が PrivacyPage として登録されている", () => {
    expect(Route.options.component?.name).toStrictEqual("PrivacyPage");
  });

  it("Privacy Policy ページが必須項目を含めて SSR される", async () => {
    const router = getRouter({
      history: createMemoryHistory({ initialEntries: ["/privacy"] }),
    });
    await router.load();
    const html = renderToString(<RouterProvider router={router} />);
    expect(html).toMatch(/<h1>Privacy Policy<\/h1>/);
    expect(html).toMatch(/hello@ryantsuji\.dev/);
    expect(html).toMatch(/Neon Postgres/);
    expect(html).toMatch(/Cloudflare Workers/);
    expect(html).toMatch(/GitHub OAuth/);
    expect(html).toMatch(/X OAuth 2\.0/);
    expect(html).toMatch(/Retention/);
    expect(html).toMatch(/← back to home/);
  });
});
