/**
 * `id.ts` の deterministicId / deterministicEdgeId が UUIDv5 として
 * 同入力に対して同 UUID を返す idempotent 性を検証。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business deterministicId / deterministicEdgeId の idempotent 性 (再 import で MERGE が機能する) と、入力が違えば衝突しないこと、edge と node で namespace が混ざらないことを smoke test
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";
import { deterministicEdgeId, deterministicId } from "./id.js";

describe("deterministicId", () => {
  it("same input → same UUID", () => {
    const a = deterministicId("x", "2050912856347226484");
    const b = deterministicId("x", "2050912856347226484");
    expect(a).toBe(b);
  });

  it("different input → different UUID", () => {
    const a = deterministicId("x", "abc");
    const b = deterministicId("x", "abd");
    expect(a).not.toBe(b);
  });

  it("different source → different UUID even with same external_id", () => {
    const a = deterministicId("x", "2050912856347226484");
    const b = deterministicId("zenn", "2050912856347226484");
    expect(a).not.toBe(b);
  });

  it("UUIDv5 format (8-4-4-4-12 hex)", () => {
    const id = deterministicId("x", "test");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("deterministicEdgeId", () => {
  it("same edge tuple → same UUID", () => {
    const a = deterministicEdgeId("authored", "persons", "p1", "contents", "c1");
    const b = deterministicEdgeId("authored", "persons", "p1", "contents", "c1");
    expect(a).toBe(b);
  });

  it("edge id ≠ node id even with same string composition", () => {
    const nodeId = deterministicId("authored:persons:p1:contents:c1", "");
    const edgeId = deterministicEdgeId("authored", "persons", "p1", "contents", "c1");
    expect(edgeId).not.toBe(nodeId);
  });

  it("direction matters: src↔tgt swap → different UUID", () => {
    const a = deterministicEdgeId("references", "contents", "c1", "decisions", "d1");
    const b = deterministicEdgeId("references", "decisions", "d1", "contents", "c1");
    expect(a).not.toBe(b);
  });
});
