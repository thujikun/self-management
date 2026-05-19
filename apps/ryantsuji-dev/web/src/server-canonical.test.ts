/**
 * `canonicalRedirectTarget` の境界網羅 test。
 *
 * 正準形 / www / http / 別ホスト / path + query / fragment / port 等の各ケースで
 * 期待する戻り値を inline で固定する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business canonical redirect の判定 + 整形を境界網羅で固定。GSC 重複 canonical 警告に直結する SoT なので、host / protocol / path-preserve / query-preserve の挙動が独立進化で壊れないようにする
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import { CANONICAL_HOST, canonicalRedirectTarget } from "./server-canonical.js";

describe("canonicalRedirectTarget", () => {
  it("正準形 (https://ryantsuji.dev/...) は null を返す (no redirect)", () => {
    expect(canonicalRedirectTarget("https://ryantsuji.dev/")).toBeNull();
    expect(canonicalRedirectTarget("https://ryantsuji.dev/posts/foo")).toBeNull();
    expect(canonicalRedirectTarget("https://ryantsuji.dev/posts/foo?lang=ja")).toBeNull();
  });

  it("www. を 落として https://ryantsuji.dev に倒す", () => {
    expect(canonicalRedirectTarget("https://www.ryantsuji.dev/")).toBe("https://ryantsuji.dev/");
    expect(canonicalRedirectTarget("https://www.ryantsuji.dev/posts/foo")).toBe(
      "https://ryantsuji.dev/posts/foo",
    );
  });

  it("http スキームを https に倒す (canonical host)", () => {
    expect(canonicalRedirectTarget("http://ryantsuji.dev/")).toBe("https://ryantsuji.dev/");
    expect(canonicalRedirectTarget("http://ryantsuji.dev/posts/foo")).toBe(
      "https://ryantsuji.dev/posts/foo",
    );
  });

  it("http://www. を https://ryantsuji.dev に倒す (host + protocol を同時に正規化)", () => {
    expect(canonicalRedirectTarget("http://www.ryantsuji.dev/")).toBe("https://ryantsuji.dev/");
    expect(canonicalRedirectTarget("http://www.ryantsuji.dev/posts/foo")).toBe(
      "https://ryantsuji.dev/posts/foo",
    );
  });

  it("query string / fragment を保持して倒す", () => {
    expect(canonicalRedirectTarget("http://www.ryantsuji.dev/posts/foo?lang=ja&utm=x")).toBe(
      "https://ryantsuji.dev/posts/foo?lang=ja&utm=x",
    );
    expect(canonicalRedirectTarget("https://www.ryantsuji.dev/posts/foo#section")).toBe(
      "https://ryantsuji.dev/posts/foo#section",
    );
  });

  it("関係ない host (例: localhost / プレビュー domain) は null (no redirect)", () => {
    expect(canonicalRedirectTarget("http://localhost:5173/posts/foo")).toBeNull();
    expect(canonicalRedirectTarget("https://ryantsuji-dev.example.workers.dev/")).toBeNull();
  });

  it("CANONICAL_HOST は ryantsuji.dev (literal 凍結)", () => {
    expect(CANONICAL_HOST).toBe("ryantsuji.dev");
  });
});
