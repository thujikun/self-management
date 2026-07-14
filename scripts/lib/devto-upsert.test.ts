/**
 * `devto-upsert.ts` (upsert 順序組立て) の test。
 *
 * reply の parentCommentId 解決は「所属トップレベルが先に insert 済み」である
 * ことに依存するため、トップレベル先行の並べ替えを回帰テストで守る。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business devto 取り込みの upsert 順序 (トップレベル先行 2 パス) と dry-run 表示整形の回帰 test。production DB への書き込み順序の正しさを pure に固定する
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";

import type { FlatComment } from "./devto-threads.js";
import { formatDryRunLine, orderCommentsForUpsert } from "./devto-upsert.js";

function flat(overrides: Partial<FlatComment> = {}): FlatComment {
  return {
    sourceCommentId: "abc",
    authorName: "Vini",
    authorUsername: "vinimabreu",
    authorProfileUrl: "https://dev.to/vinimabreu",
    sourceUrl: "https://dev.to/ryantsuji/post/comments/#comment-abc",
    body: "great point",
    createdAt: new Date("2026-05-01T00:00:00Z"),
    parentSourceId: null,
    isOwner: false,
    ...overrides,
  };
}

describe("orderCommentsForUpsert", () => {
  it("トップレベルを reply より先に並べ、各グループ内の相対順序は保つ", () => {
    // flattenOwnerThreads の出力形: thread 単位で top → reply が時系列に混在
    const flats = [
      flat({ sourceCommentId: "t1" }),
      flat({ sourceCommentId: "t1r1", parentSourceId: "t1" }),
      flat({ sourceCommentId: "t1r2", parentSourceId: "t1" }),
      flat({ sourceCommentId: "t2" }),
      flat({ sourceCommentId: "t2r1", parentSourceId: "t2" }),
    ];
    expect(orderCommentsForUpsert(flats).map((c) => c.sourceCommentId)).toStrictEqual([
      "t1",
      "t2",
      "t1r1",
      "t1r2",
      "t2r1",
    ]);
  });

  it("全 reply の parent が自身より前に現れる (parent id 解決の前提)", () => {
    const flats = [
      flat({ sourceCommentId: "a" }),
      flat({ sourceCommentId: "a-r", parentSourceId: "a" }),
      flat({ sourceCommentId: "b" }),
      flat({ sourceCommentId: "b-r", parentSourceId: "b" }),
    ];
    const ordered = orderCommentsForUpsert(flats);
    for (const [i, c] of ordered.entries()) {
      if (c.parentSourceId === null) continue;
      const parentIndex = ordered.findIndex((p) => p.sourceCommentId === c.parentSourceId);
      expect(parentIndex).toBeGreaterThanOrEqual(0);
      expect(parentIndex).toBeLessThan(i);
    }
  });
});

describe("formatDryRunLine", () => {
  it("トップレベルは • で本文 60 字 + 改行を空白化", () => {
    const line = formatDryRunLine(
      flat({ body: `${"x".repeat(70)}\ntail`, sourceCommentId: "top1" }),
    );
    expect(line).toBe(`    [dry] • Vini (top1): ${"x".repeat(60)}…`);
  });

  it("reply は ↳ 表示", () => {
    expect(formatDryRunLine(flat({ parentSourceId: "top1", body: "short\nbody" }))).toBe(
      "    [dry]   ↳ Vini (abc): short body…",
    );
  });
});
