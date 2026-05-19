/**
 * `coverPublicPath` / `shouldHaveCover` の pure 関数 test。convention path
 * (`/posts/<slug>.<lang>.cover.png`) と「PNG 生成 / 存在要求の対象 slug」の判定を
 * inline snapshot で固定し、generator (scripts/generate-covers.ts) と consumer
 * (route の og:image meta / JSON-LD / gate scripts/check-covers-exist.ts) が同 helper を
 * 経由している前提を機械的に保証する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business og:image public path helper + shouldHaveCover の inline snapshot test。format string drift や fixture skip 規約差で generator と consumer / gate がズレた瞬間 ci 落ちる
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import * as pathMod from "./path.js";

import { coverPublicPath, shouldHaveCover } from "./path.js";

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

describe("shouldHaveCover", () => {
  it("通常 slug は true (= cover 生成 / 存在要求の対象)", () => {
    expect(shouldHaveCover("hello")).toStrictEqual(true);
    expect(shouldHaveCover("17-mcp-servers")).toStrictEqual(true);
    expect(shouldHaveCover("a")).toStrictEqual(true);
  });

  it("`_` 始まり fixture / draft slug は false (= skip)", () => {
    expect(shouldHaveCover("_minimal-fixture")).toStrictEqual(false);
    expect(shouldHaveCover("_draft-example")).toStrictEqual(false);
    expect(shouldHaveCover("_")).toStrictEqual(false);
  });

  it("`_` を slug 中間に含むだけなら true (skip は先頭一致のみ)", () => {
    expect(shouldHaveCover("foo_bar")).toStrictEqual(true);
  });

  it("空文字列は true (prefix match に外れる、規約外入力は filename parser 側で弾く想定)", () => {
    expect(shouldHaveCover("")).toStrictEqual(true);
  });
});

describe("@self/og-image/path module surface", () => {
  it("export 集合は coverPublicPath + shouldHaveCover のみ (type-only `OgLang` を除く)", () => {
    // worker bundle が satori/resvg を pull しないよう、本 module は pure helper だけ
    // を露出する不変条件を inline で固定する。`./generate.ts` への import 経路が
    // 1 件でも増えると、本 module を import した consumer の bundle に native binding
    // が侵入する事故が起き得る。
    expect(Object.keys(pathMod).sort()).toStrictEqual(["coverPublicPath", "shouldHaveCover"]);
  });
});
