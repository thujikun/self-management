/**
 * `coverPublicPath` の pure 関数 test。convention path (`/posts/<slug>.<lang>.cover.png`)
 * の文字列形を inline snapshot で固定し、generator (scripts/generate-covers.ts) と
 * consumer (route の og:image meta / JSON-LD) が同 helper を経由している前提を
 * 機械的に保証する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business og:image public path helper の inline snapshot test。format string drift で generator と consumer がズレた瞬間 ci 落ちる
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import { coverPublicPath } from "./path.js";

describe("coverPublicPath", () => {
  it("en slug は `/posts/<slug>.en.cover.png`", () => {
    expect(coverPublicPath("hello", "en")).toStrictEqual("/posts/hello.en.cover.png");
  });

  it("ja slug は `/posts/<slug>.ja.cover.png`", () => {
    expect(coverPublicPath("hello", "ja")).toStrictEqual("/posts/hello.ja.cover.png");
  });

  it("`_` 始まり fixture slug でも format は同じ", () => {
    expect(coverPublicPath("_minimal-fixture", "en")).toStrictEqual(
      "/posts/_minimal-fixture.en.cover.png",
    );
  });

  it("hyphen / digit を含む slug を URL-safe にそのまま反映 (encoding は行わない)", () => {
    expect(coverPublicPath("17-mcp-servers", "ja")).toStrictEqual(
      "/posts/17-mcp-servers.ja.cover.png",
    );
  });
});
