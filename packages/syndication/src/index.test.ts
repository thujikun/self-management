/**
 * `index.ts` の re-export を smoke test。public API として expose している全 symbol が
 * runtime で参照可能か確認する。export 漏れ / typo を pre-commit / CI で機械的に拾う。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business package public surface (re-export 集) の sanity test。新規 symbol 追加時に index.ts への export を忘れた場合、import が undefined になるのを test で検出
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import * as syndication from "./index.js";

describe("@self/syndication public API", () => {
  it.each([
    "appendFooter",
    "buildDevtoArticle",
    "buildZennFrontmatter",
    "createDevtoArticle",
    "publishToDevto",
    "publishToZenn",
    "rewriteInternalLinks",
    "stringifyZennFrontmatter",
    "syndicateForDevto",
    "syndicateForZenn",
  ])("%s を re-export している", (name) => {
    expect((syndication as Record<string, unknown>)[name]).toBeDefined();
    expect(typeof (syndication as Record<string, unknown>)[name]).toBe("function");
  });
});
