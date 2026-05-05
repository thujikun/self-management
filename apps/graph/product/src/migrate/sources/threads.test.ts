/**
 * `threads.ts` の pure helper unit tests。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business threads parser の純粋ロジック (parseFrontmatter / extractTweetChain / parseThreads) のテスト。YAML frontmatter の simple/list 両形式、tweet chain の chain/tweet_ids 二系統、欠損ケース、Ryan person 自動 seed、authored edge 生成までを網羅
 * @graph-connects none
 */

import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractTweetChain, parseFrontmatter, parseThreads, SELF_PERSON_ID } from "./threads.js";

describe("parseFrontmatter", () => {
  it("frontmatter なし → fm {}, body 全文", () => {
    const { fm, body } = parseFrontmatter("hello world");
    expect(fm).toEqual({});
    expect(body).toBe("hello world");
  });

  it("scalar fields をパース、quote を剥がす", () => {
    const md = `---
short_name: dbgraph
conversation_id: "12345"
posted_at: '2026-05-04T23:14:00+09:00'
---
body content`;
    const { fm, body } = parseFrontmatter(md);
    expect(fm.short_name).toBe("dbgraph");
    expect(fm.conversation_id).toBe("12345");
    expect(fm.posted_at).toBe("2026-05-04T23:14:00+09:00");
    expect(body).toBe("body content");
  });

  it("コメント行 (# ...) は無視", () => {
    const md = `---
# this is a comment
short_name: dbgraph
---
`;
    const { fm } = parseFrontmatter(md);
    expect(fm.short_name).toBe("dbgraph");
  });

  it("不正な行は skip", () => {
    const md = `---
short_name: dbgraph
not-a-key-value-line
---
`;
    const { fm } = parseFrontmatter(md);
    expect(fm.short_name).toBe("dbgraph");
  });

  it("chain (block list of dicts) を array of records に展開", () => {
    const md = `---
chain:
  - tweet: 1
    id: "t1"
    replied_to: null
  - tweet: 2
    id: "t2"
    replied_to: "t1"
---
`;
    const { fm } = parseFrontmatter(md);
    const chain = fm.chain as Array<Record<string, string>>;
    expect(chain).toHaveLength(2);
    expect(chain[0]).toMatchObject({ tweet: "1", id: "t1" });
    expect(chain[1]).toMatchObject({ tweet: "2", id: "t2" });
  });

  it("tweet_ids (single-line dict items) を展開", () => {
    const md = `---
tweet_ids:
  - "1": "abc"
  - "2": "def"
---
`;
    const { fm } = parseFrontmatter(md);
    const ids = fm.tweet_ids as Array<Record<string, string>>;
    expect(ids).toHaveLength(2);
    expect(ids[0]).toEqual({ "1": "abc" });
    expect(ids[1]).toEqual({ "2": "def" });
  });

  it("---で始まらない場合は何もしない", () => {
    const { fm, body } = parseFrontmatter("no fence");
    expect(fm).toEqual({});
    expect(body).toBe("no fence");
  });

  it("--- は始まるが closing が無い場合は何もしない", () => {
    const { fm, body } = parseFrontmatter("---\nshort_name: x\n");
    expect(fm).toEqual({});
    expect(body).toContain("short_name");
  });

  it("4-space indent の continuation 行 (orphan) は何も collect せず i++ で進む", () => {
    // OUTER while を通すが INNER if (`  -`) には合致しないパス
    const md = `---
key:
    - 4space dash
    - 4space dash 2
---
body`;
    const { fm } = parseFrontmatter(md);
    // parser は `  -` プレフィックスでないと item として認識しない → 結果は空 list
    expect(fm.key as Array<unknown>).toEqual([]);
  });
});

describe("extractTweetChain", () => {
  it("chain 形式を尊重、conversation_id 優先", () => {
    const result = extractTweetChain({
      conversation_id: "convo-1",
      chain: [
        { tweet: 1, id: "t1", replied_to: null },
        { tweet: 2, id: "t2", replied_to: "t1" },
      ],
    });
    expect(result.conversationId).toBe("convo-1");
    expect(result.chain).toEqual([
      { tweet: 1, id: "t1" },
      { tweet: 2, id: "t2" },
    ]);
  });

  it("tweet_ids 形式 → chain に正規化、conversation_id 不在なら chain[0] を採用", () => {
    const result = extractTweetChain({
      tweet_ids: [{ "2": "id2" }, { "1": "id1" }],
    });
    expect(result.chain).toEqual([
      { tweet: 1, id: "id1" },
      { tweet: 2, id: "id2" },
    ]);
    expect(result.conversationId).toBe("id1");
  });

  it("どちらもなければ conversationId=null, chain=[]", () => {
    const result = extractTweetChain({});
    expect(result.conversationId).toBeNull();
    expect(result.chain).toEqual([]);
  });

  it("explicit conversation_id ありで chain なし", () => {
    const result = extractTweetChain({ conversation_id: "c1" });
    expect(result.conversationId).toBe("c1");
    expect(result.chain).toEqual([]);
  });
});

describe("parseThreads (integration)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "threads-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("Ryan person を必ず seed する", async () => {
    const result = await parseThreads(dir);
    expect(result.nodes[0].kind).toBe("persons");
    expect(result.nodes[0].id).toBe(SELF_PERSON_ID);
    expect(result.nodes[0].fields.primary_handle).toBe("ryantsuji");
  });

  it("ファイル 1 つ → 1 つの content + authored edge", async () => {
    await writeFile(
      join(dir, "sample.md"),
      `---
thread_name: sample
conversation_id: "9999"
posted_at_utc: "2026-05-04T14:14:00Z"
---
sample body content
`,
      "utf8",
    );
    const result = await parseThreads(dir);
    const contents = result.nodes.filter((n) => n.kind === "contents");
    expect(contents).toHaveLength(1);
    const c = contents[0];
    expect(c.fields.source).toBe("x");
    expect(c.fields.external_id).toBe("9999");
    expect(c.fields.url).toBe("https://x.com/ryantsuji/status/9999");
    expect(c.fields.author_person_id).toBe(SELF_PERSON_ID);
    expect(c.body_summary).toBeTruthy();

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({
      edge_table: "personal_edges",
      edge_type: "authored",
      src_kind: "persons",
      src_id: SELF_PERSON_ID,
      tgt_kind: "contents",
    });
  });

  it("conversation_id 欠落 → 当該ファイル skip", async () => {
    await writeFile(join(dir, "no-id.md"), "---\nshort_name: x\n---\nbody\n", "utf8");
    const result = await parseThreads(dir);
    const contents = result.nodes.filter((n) => n.kind === "contents");
    expect(contents).toHaveLength(0);
  });

  it("既知 thread_name (17mcp / dbgraph) は手書き summary を採用", async () => {
    await writeFile(
      join(dir, "17mcp.md"),
      "---\nthread_name: 17mcp\nconversation_id: \"1\"\n---\nraw body\n",
      "utf8",
    );
    const result = await parseThreads(dir);
    const c = result.nodes.find((n) => n.kind === "contents")!;
    expect(c.body_summary).toContain("17 MCP Servers");
  });

  it("posted_at_utc / posted_at どちらも無いと published_at は null", async () => {
    await writeFile(
      join(dir, "no-date.md"),
      `---\nthread_name: x\nconversation_id: \"42\"\n---\nbody\n`,
      "utf8",
    );
    const result = await parseThreads(dir);
    const c = result.nodes.find((n) => n.kind === "contents")!;
    expect(c.fields.published_at).toBeNull();
  });

  it("posted_at だけ (utc なし) → ISO 化", async () => {
    await writeFile(
      join(dir, "iso.md"),
      `---\nthread_name: x\nconversation_id: \"43\"\nposted_at: 2026-05-04T23:14:00+09:00\n---\nbody\n`,
      "utf8",
    );
    const result = await parseThreads(dir);
    const c = result.nodes.find((n) => n.kind === "contents")!;
    expect(c.fields.published_at).toBe("2026-05-04T14:14:00.000Z");
  });

  it("thread_name もない場合は file 名から fallback", async () => {
    await writeFile(
      join(dir, "fallback.md"),
      `---\nconversation_id: "44"\n---\nbody\n`,
      "utf8",
    );
    const result = await parseThreads(dir);
    const c = result.nodes.find((n) => n.kind === "contents")!;
    expect(c.fields.title).toBe("fallback");
  });

  it("body 空の thread → summary も短い fallback", async () => {
    await writeFile(
      join(dir, "empty-body.md"),
      `---\nthread_name: empty\nconversation_id: "45"\n---\n`,
      "utf8",
    );
    const result = await parseThreads(dir);
    const c = result.nodes.find((n) => n.kind === "contents")!;
    expect(c.body_summary).toBeDefined();
  });
});
