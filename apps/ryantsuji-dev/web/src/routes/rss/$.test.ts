/**
 * `/rss/$` route の handler テスト。splat → lang 解決と Response 形式を検証する。
 * 実 post は vite glob で inline されている実 content/posts に依存 (test 環境でも
 * 同じ glob を読む) — route handler の蜂蜜程度 (薄い glue) なので integration 寄り。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business RSS route handler のテスト。splat 解決、200 / 404、Content-Type / Cache-Control の wiring を網羅、本文が valid Atom XML であることまでは server/rss.test.ts で担保
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import { Route, handleRssRequest, resolveFeedLang, splatFromUrl } from "./$.js";

describe("resolveFeedLang", () => {
  it("en.xml / ja.xml は対応 lang", () => {
    expect(resolveFeedLang("en.xml")).toBe("en");
    expect(resolveFeedLang("ja.xml")).toBe("ja");
  });

  it("未対応 splat は null", () => {
    expect(resolveFeedLang("zh.xml")).toBeNull();
    expect(resolveFeedLang("feed.xml")).toBeNull();
    expect(resolveFeedLang("en")).toBeNull();
    expect(resolveFeedLang("")).toBeNull();
    expect(resolveFeedLang(undefined)).toBeNull();
  });
});

describe("splatFromUrl", () => {
  it("/rss/<splat> から splat 部分を抽出", () => {
    expect(splatFromUrl("https://example.com/rss/en.xml")).toBe("en.xml");
    expect(splatFromUrl("https://example.com/rss/ja.xml?foo=bar")).toBe("ja.xml");
    expect(splatFromUrl("https://example.com/rss/")).toBe("");
  });

  it("/rss/ 配下でない URL は undefined", () => {
    expect(splatFromUrl("https://example.com/posts/x")).toBeUndefined();
    expect(splatFromUrl("https://example.com/api/health")).toBeUndefined();
    expect(splatFromUrl("https://example.com/rssX/y")).toBeUndefined();
  });
});

describe("Route (createFileRoute wiring)", () => {
  it("GET handler が export されており handleRssRequest に splat を渡す", async () => {
    // server.handlers.GET は本物の Request を受けて Response を返す closure。
    // 直接 invoke して end-to-end の path (splat 抽出 → handleRssRequest → Response)
    // が wire 済であることを assert。Route option の型は TanStack Start 内部実装の
    // ため runtime shape のみを軽く触る。
    const handlers = (
      Route.options as {
        server?: { handlers?: { GET?: (a: { request: Request }) => Response | Promise<Response> } };
      }
    ).server?.handlers;
    const get = handlers?.GET;
    expect(typeof get).toBe("function");
    const res = await get!({ request: new Request("https://x.test/rss/en.xml") });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/atom+xml; charset=utf-8");
  });
});

describe("handleRssRequest", () => {
  it("en.xml: 200 + Atom XML + cache-control", async () => {
    const res = handleRssRequest("en.xml");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/atom+xml; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=300");
    const body = await res.text();
    expect(body).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(body).toContain('xml:lang="en"');
    expect(body).toContain('href="https://ryantsuji.dev/rss/en.xml"');
  });

  it("ja.xml: xml:lang=ja + ?lang=ja URLs", async () => {
    const res = handleRssRequest("ja.xml");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('xml:lang="ja"');
    expect(body).toContain("?lang=ja");
  });

  it("未対応 splat: 404", async () => {
    const res = handleRssRequest("feed.xml");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not Found");
  });

  it("splat undefined: 404", async () => {
    const res = handleRssRequest(undefined);
    expect(res.status).toBe(404);
  });
});
