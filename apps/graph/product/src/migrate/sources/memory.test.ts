/**
 * `memory.ts` の pure helper unit tests。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business memory parser の純粋ロジック (parseFrontmatter / parseMemory) のテスト。frontmatter type で decisions / topics 振り分け、reference skip、body_summary 構築 (description + 1 段落目)、authored edge を network レベルまで網羅
 * @graph-connects none
 */

import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseFrontmatter, parseMemory } from "./memory.js";

describe("parseFrontmatter (memory variant)", () => {
  it("frontmatter 全フィールド (name / description / type) を抽出", () => {
    const md = `---
name: Some name
description: short desc
type: feedback
---
body content`;
    const { fm, body } = parseFrontmatter(md);
    expect(fm.name).toBe("Some name");
    expect(fm.description).toBe("short desc");
    expect(fm.type).toBe("feedback");
    expect(body).toBe("body content");
  });

  it("frontmatter なし → fm {}, body 全文", () => {
    const { fm, body } = parseFrontmatter("hello");
    expect(fm).toEqual({});
    expect(body).toBe("hello");
  });

  it("正しい closing fence がない場合は空 fm で返す", () => {
    const { fm } = parseFrontmatter("---\nname: x\n");
    expect(fm).toEqual({});
  });

  it("body は trim される", () => {
    const md = `---
name: x
---


   body with leading whitespace

`;
    const { body } = parseFrontmatter(md);
    expect(body.startsWith("body with leading whitespace")).toBe(true);
  });

  it("不正な行 (key:value 形式でない) は skip", () => {
    const md = `---
name: ok
this is not a valid key value line
description: also ok
---
b`;
    const { fm } = parseFrontmatter(md);
    expect(fm.name).toBe("ok");
    expect(fm.description).toBe("also ok");
  });
});

describe("parseMemory", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "memory-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("type=feedback / type=user は decisions として登録、authored edge も張る", async () => {
    await writeFile(
      join(dir, "fb.md"),
      `---
name: feedback rule
description: short
type: feedback
---
First paragraph.

second paragraph
`,
      "utf8",
    );
    await writeFile(
      join(dir, "user.md"),
      `---
name: user role
description: who
type: user
---
about user
`,
      "utf8",
    );
    const result = await parseMemory(dir);
    const decisions = result.nodes.filter((n) => n.kind === "decisions");
    expect(decisions).toHaveLength(2);

    // body_summary = description + " — " + first paragraph
    const fb = decisions.find((n) => n.fields.title === "feedback rule")!;
    expect(fb.body_summary).toContain("short");
    expect(fb.body_summary).toContain("First paragraph");

    // authored edge ごとに 1 件
    expect(result.edges.filter((e) => e.edge_type === "authored")).toHaveLength(2);
  });

  it("type=project は topics として登録、authored edge は張らない", async () => {
    await writeFile(
      join(dir, "proj.md"),
      `---
name: graph design
description: distilled
type: project
---
content
`,
      "utf8",
    );
    const result = await parseMemory(dir);
    const topics = result.nodes.filter((n) => n.kind === "topics");
    expect(topics).toHaveLength(1);
    expect(topics[0].fields.name).toBe("graph design");
    expect(result.edges).toEqual([]);
  });

  it("type=reference は skip", async () => {
    await writeFile(
      join(dir, "ref.md"),
      `---
name: ref
type: reference
---
body
`,
      "utf8",
    );
    const result = await parseMemory(dir);
    expect(result.nodes).toEqual([]);
  });

  it("type 不明は warn して skip (node 作らない)", async () => {
    await writeFile(join(dir, "weird.md"), `---\nname: x\n---\nb\n`, "utf8");
    const result = await parseMemory(dir);
    expect(result.nodes).toEqual([]);
  });

  it("MEMORY.md 自身は対象外", async () => {
    await writeFile(join(dir, "MEMORY.md"), `index file\n`, "utf8");
    await writeFile(join(dir, "x.md"), `---\nname: ok\ntype: feedback\n---\nbody\n`, "utf8");
    const result = await parseMemory(dir);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].fields.title).toBe("ok");
  });

  it("name が無い feedback → title に externalId 採用 (fm.name ?? externalId fallback)", async () => {
    await writeFile(join(dir, "no-name.md"), `---\ntype: feedback\n---\nbody\n`, "utf8");
    const result = await parseMemory(dir);
    expect(result.nodes[0].fields.title).toBe("no-name");
  });

  it("name が無い project → topic name に externalId 採用", async () => {
    await writeFile(join(dir, "no-name-proj.md"), `---\ntype: project\n---\nbody\n`, "utf8");
    const result = await parseMemory(dir);
    expect(result.nodes[0].fields.name).toBe("no-name-proj");
  });

  it("description / body 両方ない feedback → summary は空文字 (空 join)", async () => {
    await writeFile(join(dir, "minimal.md"), `---\nname: x\ntype: feedback\n---\n\n`, "utf8");
    const result = await parseMemory(dir);
    expect(result.nodes[0].body_summary).toBe("");
  });

  it("description のみ (body 空) → summary = description", async () => {
    await writeFile(
      join(dir, "desc-only.md"),
      `---\nname: x\ndescription: short\ntype: feedback\n---\n`,
      "utf8",
    );
    const result = await parseMemory(dir);
    expect(result.nodes[0].body_summary).toBe("short");
  });

  it("description ない project → metadata.description=null", async () => {
    await writeFile(join(dir, "p.md"), `---\nname: x\ntype: project\n---\nbody\n`, "utf8");
    const result = await parseMemory(dir);
    const meta = result.nodes[0].metadata as Record<string, unknown>;
    expect(meta).toBeDefined();
    expect(result.nodes[0].fields.description).toBeNull();
  });
});
