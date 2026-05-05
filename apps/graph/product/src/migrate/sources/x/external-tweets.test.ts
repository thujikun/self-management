/**
 * `external-tweets.ts` の unit test。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business userToPersonNode / externalTweetToContentNode / externalTweetsToNodes の純粋ロジック検証。author 不在時の null fallback、metadataExtra 反映、handle case 正規化を網羅
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";
import { deterministicId } from "../../common/id.js";
import { PERSON_SOURCE } from "./accounts.js";
import {
  externalTweetToContentNode,
  externalTweetsToNodes,
  userToPersonNode,
  type XUserRaw,
} from "./external-tweets.js";

const userA: XUserRaw = {
  id: "u1",
  username: "Alice",
  name: "Alice Wonderland",
  description: "tea enthusiast",
};

describe("userToPersonNode", () => {
  it("lowercases username for person_id", () => {
    const n = userToPersonNode(userA);
    expect(n.id).toBe(deterministicId(PERSON_SOURCE, "alice"));
    expect(n.fields.primary_handle).toBe("Alice"); // 元の case は preserve
  });

  it("uses description as body_summary; falls back to name then username", () => {
    expect(userToPersonNode(userA).body_summary).toBe("tea enthusiast");
    expect(userToPersonNode({ id: "u2", username: "B", name: "Bob" }).body_summary).toBe("Bob");
    expect(userToPersonNode({ id: "u3", username: "C" }).body_summary).toBe("C");
  });

  it("includes both x and x_id identifiers", () => {
    const idents = userToPersonNode(userA).fields.identifiers as Array<{
      platform: string;
      value: string;
    }>;
    expect(idents).toEqual([
      { platform: "x", value: "Alice" },
      { platform: "x_id", value: "u1" },
    ]);
  });

  it('marks metadata.role = "external"', () => {
    const n = userToPersonNode(userA);
    expect((n.metadata as { role: string }).role).toBe("external");
  });
});

describe("externalTweetToContentNode", () => {
  it("links content to author person_id when author is found", () => {
    const authors = new Map([["u1", userA]]);
    const { content, authorPersonId } = externalTweetToContentNode(
      { id: "t1", text: "hi", author_id: "u1" },
      authors,
    );
    expect(authorPersonId).toBe(deterministicId(PERSON_SOURCE, "alice"));
    expect(content.fields.author_person_id).toBe(authorPersonId);
    expect(content.fields.url).toBe("https://x.com/Alice/status/t1");
  });

  it("returns null author when author_id is missing or not in includes", () => {
    const { content, authorPersonId } = externalTweetToContentNode(
      { id: "t1", text: "hi" },
      new Map(),
    );
    expect(authorPersonId).toBeNull();
    expect(content.fields.author_person_id).toBeNull();
    expect(content.fields.url).toBe("https://x.com/unknown/status/t1");
  });

  it("propagates metadataExtra into content.metadata", () => {
    const authors = new Map([["u1", userA]]);
    const { content } = externalTweetToContentNode(
      { id: "t1", text: "hi", author_id: "u1" },
      authors,
      { engagement: "like", account: "ryantsuji" },
    );
    const md = content.metadata as Record<string, unknown>;
    expect(md.engagement).toBe("like");
    expect(md.account).toBe("ryantsuji");
    expect(md.author_handle).toBe("Alice");
  });
});

describe("externalTweetsToNodes", () => {
  it("returns separate content / person arrays + contentToAuthor map", () => {
    const tweets = [
      { id: "t1", text: "hi", author_id: "u1" },
      { id: "t2", text: "yo", author_id: "u1" },
    ];
    const authors = [userA];
    const result = externalTweetsToNodes(tweets, authors);
    expect(result.contentNodes).toHaveLength(2);
    expect(result.personNodes).toHaveLength(1);
    expect(result.personNodes[0].kind).toBe("persons");
    expect(result.contentToAuthor.size).toBe(2);
    const expected = deterministicId(PERSON_SOURCE, "alice");
    for (const v of result.contentToAuthor.values()) {
      expect(v).toBe(expected);
    }
  });

  it("omits contentToAuthor entry when author is missing", () => {
    const result = externalTweetsToNodes(
      [{ id: "t1", text: "hi" }],
      [],
    );
    expect(result.contentNodes).toHaveLength(1);
    expect(result.contentToAuthor.size).toBe(0);
  });

  it("uses default empty arrays when called with no args", () => {
    const result = externalTweetsToNodes([]);
    expect(result.contentNodes).toEqual([]);
    expect(result.personNodes).toEqual([]);
    expect(result.contentToAuthor.size).toBe(0);
  });
});
