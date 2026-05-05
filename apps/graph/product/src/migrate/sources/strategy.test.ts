/**
 * `strategy.ts` の unit tests。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business strategy doc parser のテスト。1 ファイル = 1 decision の構造、H1 から title 抽出、欠損時 fallback、authored edge を Ryan 本人に張る挙動を網羅
 * @graph-connects none
 */

import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseStrategyDoc } from "./strategy.js";
import { SELF_PERSON_ID } from "./threads.js";

describe("parseStrategyDoc", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "strategy-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("H1 を title に採用、source は 'strategy-doc'", async () => {
    const path = join(dir, "strategy.md");
    await writeFile(path, "# My Strategy\n\nbody here\n", "utf8");
    const result = await parseStrategyDoc(path);
    expect(result.source).toBe("strategy-doc");
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].kind).toBe("decisions");
    expect(result.nodes[0].fields.title).toBe("My Strategy");
  });

  it("H1 がなければ fallback title", async () => {
    const path = join(dir, "no-h1.md");
    await writeFile(path, "no header here\n", "utf8");
    const result = await parseStrategyDoc(path);
    expect(result.nodes[0].fields.title).toBe("X account strategy");
  });

  it("body_summary は事前にハードコードされた要約を返す", async () => {
    const path = join(dir, "x.md");
    await writeFile(path, "# X\nbody\n", "utf8");
    const result = await parseStrategyDoc(path);
    expect(result.nodes[0].body_summary).toContain("@ryantsuji");
  });

  it("authored edge を Ryan 本人 → decision に張る", async () => {
    const path = join(dir, "x.md");
    await writeFile(path, "# X\nbody\n", "utf8");
    const result = await parseStrategyDoc(path);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({
      edge_table: "personal_edges",
      edge_type: "authored",
      src_id: SELF_PERSON_ID,
      tgt_kind: "decisions",
    });
    expect(result.edges[0].tgt_id).toBe(result.nodes[0].id);
  });

  it("rationale_md は markdown 全文を保持", async () => {
    const path = join(dir, "x.md");
    const md = "# X\n\n## Section\nfull body";
    await writeFile(path, md, "utf8");
    const result = await parseStrategyDoc(path);
    expect(result.nodes[0].fields.rationale_md).toBe(md);
  });
});
