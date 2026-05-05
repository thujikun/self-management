/**
 * `server.ts` の smoke test。
 *
 * createServer() で MCP Server instance が作れること、ListTools が 4 tools を返すこと、
 * 各 tool 呼び出しが内部関数を呼ぶことを in-memory transport で確認する。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business MCP server factory のスモーク。tools 一覧の内容、CallTool ハンドラの dispatch、未知 tool の例外を網羅
 * @graph-connects none
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 内部 tool 関数を全て mock
vi.mock("./tools/search-nodes.js", () => ({
  searchNodes: vi.fn().mockResolvedValue([{ kind: "contents", id: "x" }]),
}));
vi.mock("./tools/get-node.js", () => ({
  getNode: vi.fn().mockResolvedValue({ kind: "contents", row: {}, edges: [] }),
}));
vi.mock("./tools/traverse.js", () => ({
  traverse: vi.fn().mockResolvedValue([{ depth: 1 }]),
}));
vi.mock("./tools/list-recent.js", () => ({
  listRecent: vi.fn().mockResolvedValue([{ id: "r" }]),
}));
// withSpan は OTel を動かさず単にコールバックを実行する fake にする
vi.mock("@self/otel", () => ({
  withSpan: <T>(_n: string, _a: object, fn: () => Promise<T> | T) => fn(),
}));

describe("createServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("instance が tool 4 つを公開する", async () => {
    const { createServer } = await import("./server.js");
    const server = createServer();
    expect(server).toBeDefined();
    // 内部 _requestHandlers から ListToolsRequest の handler を取って呼ぶ
    // SDK の protected API なので handler 直接呼びはしない。代わりに dispatch が動くか確認するために
    // CallToolRequestSchema 経由で実行できることだけ確認 (server.ts の registerTool が無事完了)。
  });

  it("CallTool: search_nodes を dispatch", async () => {
    const { createServer } = await import("./server.js");
    const server = createServer();
    // 内部 handler に直接 access するため private prop を取り出す (SDK は handler を Map 形式で保持)
    const handler = (
      server as unknown as {
        _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
      }
    )._requestHandlers.get("tools/call");
    expect(handler).toBeDefined();
    const out = (await handler!({
      method: "tools/call",
      params: { name: "search_nodes", arguments: { query: "hello" } },
    })) as { content: Array<{ type: string; text: string }> };
    expect(out.content[0].type).toBe("text");
    const parsed = JSON.parse(out.content[0].text);
    expect(parsed[0].kind).toBe("contents");
  });

  it("CallTool: get_node", async () => {
    const { createServer } = await import("./server.js");
    const server = createServer();
    const handler = (
      server as unknown as {
        _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
      }
    )._requestHandlers.get("tools/call");
    const out = (await handler!({
      method: "tools/call",
      params: { name: "get_node", arguments: { kind: "contents", id: "x" } },
    })) as { content: Array<{ text: string }> };
    expect(JSON.parse(out.content[0].text).kind).toBe("contents");
  });

  it("CallTool: traverse", async () => {
    const { createServer } = await import("./server.js");
    const server = createServer();
    const handler = (
      server as unknown as {
        _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
      }
    )._requestHandlers.get("tools/call");
    const out = (await handler!({
      method: "tools/call",
      params: { name: "traverse", arguments: { kind: "persons", id: "p1" } },
    })) as { content: Array<{ text: string }> };
    expect(JSON.parse(out.content[0].text)[0].depth).toBe(1);
  });

  it("CallTool: list_recent", async () => {
    const { createServer } = await import("./server.js");
    const server = createServer();
    const handler = (
      server as unknown as {
        _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
      }
    )._requestHandlers.get("tools/call");
    const out = (await handler!({
      method: "tools/call",
      params: { name: "list_recent", arguments: { kind: "release_notes" } },
    })) as { content: Array<{ text: string }> };
    expect(JSON.parse(out.content[0].text)[0].id).toBe("r");
  });

  it("CallTool: 未知 tool → throw", async () => {
    const { createServer } = await import("./server.js");
    const server = createServer();
    const handler = (
      server as unknown as {
        _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
      }
    )._requestHandlers.get("tools/call");
    await expect(
      handler!({ method: "tools/call", params: { name: "nonexistent", arguments: {} } }),
    ).rejects.toThrow(/Unknown tool/);
  });

  it("ListTools: 4 つの tool を返す", async () => {
    const { createServer } = await import("./server.js");
    const server = createServer();
    const handler = (
      server as unknown as {
        _requestHandlers: Map<
          string,
          (req: unknown) => Promise<{ tools: Array<{ name: string }> }>
        >;
      }
    )._requestHandlers.get("tools/list");
    const out = await handler!({ method: "tools/list", params: {} });
    expect(out.tools).toHaveLength(4);
    const names = out.tools.map((t) => t.name);
    expect(names).toEqual(["search_nodes", "get_node", "traverse", "list_recent"]);
  });
});
