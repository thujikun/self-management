/**
 * `index.ts` の re-export を barrel snapshot で固定する。`Object.keys(module).sort()`
 * を `toMatchInlineSnapshot` で fix することで、export の追加 / 削除を必ず PR diff として可視化し、
 * 公開 API surface 変更を機械的にレビュー対象にする。
 *
 * 型 export は runtime に現れないため、ここでは検証しない (型側の retention は consumer
 * 側 import 文 + tsc が検証する)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business package public surface (re-export 集) の snapshot test。runtime export の集合を `toMatchInlineSnapshot` で固定し、export 追加 / 削除を PR diff として強制可視化する (testing.md "barrel テスト" 節準拠)
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import * as syndication from "./index.js";

describe("@self/syndication public API", () => {
  it("公開している runtime export の集合を snapshot で固定する", () => {
    expect(Object.keys(syndication).sort()).toMatchInlineSnapshot(`
      [
        "AI_DISCLOSURE_MARKDOWN",
        "appendFooter",
        "buildDevtoArticle",
        "buildZennFrontmatter",
        "cleanupOrphanZennArticles",
        "createDevtoArticle",
        "ensureZennRepoCloned",
        "prependAiDisclosure",
        "publishToDevto",
        "publishToZenn",
        "rewriteInternalLinks",
        "stringifyZennFrontmatter",
        "syndicateForDevto",
        "syndicateForZenn",
      ]
    `);
  });
});
