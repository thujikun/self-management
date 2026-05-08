/**
 * MCP server factory (transport agnostic)。
 *
 * stdio / http どちらの transport でも同じ tool 実装を使えるよう、
 * 4 tools を `Server` に登録した instance を返すだけの factory。
 *
 * 各 tool handler は内部 lib (search-nodes / get-node / traverse / list-recent) を
 * inject 可能にしてあるため、test では mock を渡す。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business MCP server の transport 非依存 factory。stdio エントリ (bin/) からも将来の http エントリからも同じ tool 群を起動できる
 * @graph-connects opentelemetry [calls] tool 呼び出しを span でラップして観測
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { withSpan } from "@self/otel";
import { NODE_TABLES } from "./bq.js";
import { searchNodes } from "./tools/search-nodes.js";
import { getNode } from "./tools/get-node.js";
import { traverse } from "./tools/traverse.js";
import { listRecent } from "./tools/list-recent.js";

/** @graph-connects none */
const NodeTableSchema = z.enum(NODE_TABLES);

/**
 * MCP transport は integer 引数を string でも投げてくる (JSON-RPC 経由のクライアント実装による)。
 * `z.coerce.number()` で string/number 両受け、内部では number として扱う。
 *
 * @graph-connects none
 */
const IntCoerce = z.coerce.number().int();

/** @graph-connects none */
const SearchInputSchema = z.object({
  query: z.string(),
  kind: NodeTableSchema.optional(),
  limit: IntCoerce.min(1).max(50).optional(),
});

/** @graph-connects none */
const GetNodeInputSchema = z.object({
  kind: NodeTableSchema,
  id: z.string(),
});

/** @graph-connects none */
const TraverseInputSchema = z.object({
  kind: z.string(),
  id: z.string(),
  edgeType: z.string().optional(),
  direction: z.enum(["out", "in", "both"]).optional(),
  maxDepth: IntCoerce.min(1).max(3).optional(),
});

/** @graph-connects none */
const ListRecentInputSchema = z.object({
  kind: NodeTableSchema,
  since: z.string().optional(),
  limit: IntCoerce.min(1).max(100).optional(),
});

/**
 * MCP `Server` に 4 つの tool を登録して返す。caller が transport を bind する。
 *
 * @graph-connects opentelemetry [calls] withSpan で各 tool 呼び出しを観測
 */
export function createServer(): Server {
  const server = new Server(
    { name: "ryan-graph", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "search_nodes",
        description:
          "Semantic search over Ryan's personal product graph using gemini-embedding-2 + COSINE distance. Returns top-N hits across all node tables (or filtered by kind).",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Natural language query" },
            kind: { type: "string", enum: [...NODE_TABLES], description: "Filter by node table" },
            limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
          },
          required: ["query"],
        },
      },
      {
        name: "get_node",
        description: "Fetch a single node (full row + connected edges, embedding column excluded).",
        inputSchema: {
          type: "object",
          properties: {
            kind: { type: "string", enum: [...NODE_TABLES] },
            id: { type: "string" },
          },
          required: ["kind", "id"],
        },
      },
      {
        name: "traverse",
        description:
          "BFS traverse from a node up to maxDepth (capped at 3). Filter by edgeType and direction.",
        inputSchema: {
          type: "object",
          properties: {
            kind: { type: "string" },
            id: { type: "string" },
            edgeType: { type: "string" },
            direction: { type: "string", enum: ["out", "in", "both"], default: "both" },
            maxDepth: { type: "integer", minimum: 1, maximum: 3, default: 2 },
          },
          required: ["kind", "id"],
        },
      },
      {
        name: "list_recent",
        description:
          "Time-ordered DESC listing of nodes for a given kind. Use 'since' (ISO 8601) for cutoff.",
        inputSchema: {
          type: "object",
          properties: {
            kind: { type: "string", enum: [...NODE_TABLES] },
            since: { type: "string", description: "ISO 8601 timestamp" },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          },
          required: ["kind"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: rawArgs } = req.params;
    return withSpan(`mcp.tool.${name}`, { tool: name }, async () => {
      switch (name) {
        case "search_nodes": {
          const args = SearchInputSchema.parse(rawArgs);
          const hits = await searchNodes(args);
          return { content: [{ type: "text", text: JSON.stringify(hits, null, 2) }] };
        }
        case "get_node": {
          const args = GetNodeInputSchema.parse(rawArgs);
          const detail = await getNode(args);
          return { content: [{ type: "text", text: JSON.stringify(detail, null, 2) }] };
        }
        case "traverse": {
          const args = TraverseInputSchema.parse(rawArgs);
          const edges = await traverse(args);
          return { content: [{ type: "text", text: JSON.stringify(edges, null, 2) }] };
        }
        case "list_recent": {
          const args = ListRecentInputSchema.parse(rawArgs);
          const rows = await listRecent(args);
          return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
        }
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });
  });

  return server;
}
