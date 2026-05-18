/**
 * `/sitemap.xml` route handler のテスト。実 post / series は
 * `virtual:rendered-posts` (vitest plugin で pre-rendered) / `SERIES_REGISTRY` から
 * 供給される。route 自体は薄い glue (post 取得 + sitemap builder + Response 整形)
 * なので integration 寄りで wire を担保する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business /sitemap.xml route の wiring テスト。Content-Type / Cache-Control / XML header の存在、本物の post / series が反映されること、本文が valid sitemap XML 形式であることを担保
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import { Route, handleSitemapRequest } from "./sitemap[.]xml.js";

describe("handleSitemapRequest", () => {
  it("Response shape — 200 / application/xml / cache-control / XML header", async () => {
    const res = handleSitemapRequest(new Date("2026-05-18T00:00:00Z"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600, s-maxage=3600");
    const body = await res.text();
    expect(body.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(body).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n        xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    );
    expect(body.trimEnd().endsWith("</urlset>")).toBe(true);
  });

  it("static / series / post が含まれる + buildDate が反映される", async () => {
    const res = handleSitemapRequest(new Date("2026-05-18T12:34:56Z"));
    const body = await res.text();
    // static
    expect(body).toContain("<loc>https://ryantsuji.dev/</loc>");
    expect(body).toContain("<loc>https://ryantsuji.dev/about</loc>");
    expect(body).toContain("<loc>https://ryantsuji.dev/posts</loc>");
    expect(body).toContain("<loc>https://ryantsuji.dev/privacy</loc>");
    expect(body).toContain("<loc>https://ryantsuji.dev/terms</loc>");
    // series (registry に必ずある building-ai-harness)
    expect(body).toContain("<loc>https://ryantsuji.dev/series/building-ai-harness</loc>");
    // build date が static entries の lastmod に乗る
    expect(body).toContain("<lastmod>2026-05-18</lastmod>");
    // post 1 件以上が hreflang alternate 付きで載る
    expect(body).toMatch(/<xhtml:link rel="alternate" hreflang="en" href=".*\/posts\//);
    // x-default が含まれる
    expect(body).toContain('hreflang="x-default"');
  });

  it("draft post は public sitemap に出ない (listPosts は includeDrafts=false 既定)", async () => {
    // production deploy で draft が漏れないことの最低限の wire 担保。
    // listPosts 自体の draft 除外 test は server/posts.test.ts が SoT。
    const res = handleSitemapRequest(new Date("2026-05-18T00:00:00Z"));
    const body = await res.text();
    // `_` prefix は test fixture 用 / draft は published only filter 済
    expect(body).not.toMatch(/<loc>https:\/\/ryantsuji\.dev\/posts\/_/);
  });
});

describe("Route (createFileRoute wiring)", () => {
  it("GET handler が export されており handleSitemapRequest を呼ぶ", async () => {
    const handlers = (
      Route.options as {
        server?: { handlers?: { GET?: (a: { request: Request }) => Response | Promise<Response> } };
      }
    ).server?.handlers;
    const get = handlers?.GET;
    expect(typeof get).toBe("function");
    const res = await get!({ request: new Request("https://x.test/sitemap.xml") });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/xml; charset=utf-8");
  });
});
