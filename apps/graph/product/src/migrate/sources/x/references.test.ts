/**
 * `references.ts` の unit test (pure post-processor の純粋ロジック検証)。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business REFERENCE_TYPE_MAP の対応、extractReferencedTweets の不正形式 reject、buildReferencedEdges の dedupe / self-reference skip / retweet→references 正規化、findMissingReferenceIds の集合演算を網羅
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";
import { deterministicId } from "../../common/id.js";
import type { NodeInput } from "../../common/types.js";
import {
  buildReferencedEdges,
  extractReferencedTweets,
  findMissingReferenceIds,
  REFERENCE_TYPE_MAP,
  tweetIdToContentId,
} from "./references.js";

function contentNode(externalId: string, refs: unknown): NodeInput {
  return {
    kind: "contents",
    id: deterministicId("x", externalId),
    fields: { content_id: deterministicId("x", externalId), external_id: externalId },
    metadata: { referenced_tweets: refs } as Record<string, unknown>,
  };
}

describe("REFERENCE_TYPE_MAP", () => {
  it("maps the 3 X reference types correctly", () => {
    expect(REFERENCE_TYPE_MAP.replied_to).toBe("replied_to");
    expect(REFERENCE_TYPE_MAP.quoted).toBe("quoted");
    expect(REFERENCE_TYPE_MAP.retweeted).toBe("references");
  });
});

describe("tweetIdToContentId", () => {
  it("matches deterministicId('x', tweetId) used by posts.ts", () => {
    expect(tweetIdToContentId("123")).toBe(deterministicId("x", "123"));
  });
});

describe("extractReferencedTweets", () => {
  it("returns valid entries only, filtering malformed", () => {
    const node = contentNode("a", [
      { type: "replied_to", id: "r1" },
      { type: "quoted", id: "q1" },
      { type: "retweeted", id: "rt1" },
      { type: "unknown", id: "u1" }, // unknown type
      { type: "replied_to" }, // missing id
      { id: "x" }, // missing type
      "garbage",
      null,
    ]);
    expect(extractReferencedTweets(node)).toEqual([
      { type: "replied_to", id: "r1" },
      { type: "quoted", id: "q1" },
      { type: "retweeted", id: "rt1" },
    ]);
  });

  it("returns [] for missing / non-array metadata.referenced_tweets", () => {
    expect(extractReferencedTweets(contentNode("a", undefined))).toEqual([]);
    expect(extractReferencedTweets(contentNode("a", null))).toEqual([]);
    expect(extractReferencedTweets(contentNode("a", "not-array"))).toEqual([]);
    const noMeta: NodeInput = { kind: "contents", id: "x", fields: {} };
    expect(extractReferencedTweets(noMeta)).toEqual([]);
  });
});

describe("buildReferencedEdges", () => {
  it("creates 1 edge per valid reference, with src=contents and tgt=contents", () => {
    const nodes = [
      contentNode("a", [{ type: "replied_to", id: "r1" }]),
      contentNode("b", [{ type: "quoted", id: "q1" }]),
    ];
    const edges = buildReferencedEdges(nodes);
    expect(edges).toHaveLength(2);
    expect(edges[0]).toMatchObject({
      edge_table: "personal_edges",
      edge_type: "replied_to",
      src_kind: "contents",
      tgt_kind: "contents",
    });
    expect(edges[0].src_id).toBe(deterministicId("x", "a"));
    expect(edges[0].tgt_id).toBe(deterministicId("x", "r1"));
    expect(edges[1].edge_type).toBe("quoted");
  });

  it("normalizes retweeted → references with x_reference_type='retweeted' in properties", () => {
    const edges = buildReferencedEdges([
      contentNode("a", [{ type: "retweeted", id: "rt1" }]),
    ]);
    expect(edges).toHaveLength(1);
    expect(edges[0].edge_type).toBe("references");
    expect((edges[0].properties as { x_reference_type: string }).x_reference_type).toBe(
      "retweeted",
    );
  });

  it("dedupes same (src, type, target) edge across multiple traversals", () => {
    const nodes = [
      contentNode("a", [
        { type: "replied_to", id: "r1" },
        { type: "replied_to", id: "r1" },
      ]),
    ];
    expect(buildReferencedEdges(nodes)).toHaveLength(1);
  });

  it("skips self-reference (src_id === tgt_id)", () => {
    const id = "loop";
    const nodes = [contentNode(id, [{ type: "replied_to", id }])];
    expect(buildReferencedEdges(nodes)).toEqual([]);
  });

  it("skips non-contents nodes (e.g. persons)", () => {
    const persons: NodeInput = {
      kind: "persons",
      id: "p1",
      fields: {},
      metadata: { referenced_tweets: [{ type: "replied_to", id: "x" }] },
    };
    expect(buildReferencedEdges([persons])).toEqual([]);
  });
});

describe("findMissingReferenceIds", () => {
  it("returns referenced ids that are NOT in the contents external_id set", () => {
    const nodes = [
      contentNode("own1", [{ type: "replied_to", id: "external1" }]),
      contentNode("own2", [{ type: "quoted", id: "own1" }]), // own1 は含まれてる
      contentNode("own3", [{ type: "retweeted", id: "external2" }]),
    ];
    const missing = findMissingReferenceIds(nodes).sort();
    expect(missing).toEqual(["external1", "external2"]);
  });

  it("dedupes referenced ids", () => {
    const nodes = [
      contentNode("a", [{ type: "replied_to", id: "x1" }]),
      contentNode("b", [{ type: "quoted", id: "x1" }]),
    ];
    expect(findMissingReferenceIds(nodes)).toEqual(["x1"]);
  });

  it("returns [] when no references are present", () => {
    expect(findMissingReferenceIds([contentNode("a", [])])).toEqual([]);
  });
});
