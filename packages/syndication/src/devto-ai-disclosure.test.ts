/**
 * `prependAiDisclosure` の境界網羅。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business AI disclosure prepend の境界 test。 normal prepend / marker idempotency / body 先頭 whitespace 正規化を網羅
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import { AI_DISCLOSURE_MARKDOWN, prependAiDisclosure } from "./devto-ai-disclosure.js";

describe("prependAiDisclosure", () => {
  it("通常 body の先頭に disclosure を空行 1 つ挟んで prepend する", () => {
    const out = prependAiDisclosure("Hi, I'm Ryan...\n\nbody.");
    expect(out.startsWith(AI_DISCLOSURE_MARKDOWN)).toBe(true);
    expect(out).toBe(`${AI_DISCLOSURE_MARKDOWN}\n\nHi, I'm Ryan...\n\nbody.`);
  });

  it("body 先頭の余分な改行 / whitespace は剥がして prepend する", () => {
    const out = prependAiDisclosure("\n\n  Hi, I'm Ryan...");
    expect(out).toBe(`${AI_DISCLOSURE_MARKDOWN}\n\nHi, I'm Ryan...`);
  });

  it("既に AI disclosure marker を含む body は二重 prepend しない (idempotent)", () => {
    const already = `${AI_DISCLOSURE_MARKDOWN}\n\nHi, I'm Ryan...`;
    expect(prependAiDisclosure(already)).toBe(already);
  });

  it("idempotency は marker comment 単独でも成立する (= 文言が将来変わっても二重化しない)", () => {
    const withMarkerOnly = "<!-- ai-disclosure -->\n> old custom disclosure\n\nHi.";
    expect(prependAiDisclosure(withMarkerOnly)).toBe(withMarkerOnly);
  });

  it("空 body でも disclosure 単独で返り crash しない", () => {
    expect(prependAiDisclosure("")).toBe(`${AI_DISCLOSURE_MARKDOWN}\n\n`);
  });
});
