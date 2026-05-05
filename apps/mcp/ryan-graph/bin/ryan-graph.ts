#!/usr/bin/env tsx
/**
 * mcp-ryan-graph stdio entry point。
 *
 * `.mcp.json` から `tsx apps/mcp/ryan-graph/bin/ryan-graph.ts` で起動される。
 * stdin/stdout で MCP プロトコルを話す pure CLI。pure logic は src/server.ts に分離。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business stdio transport で MCP server を起動する CLI wrapper。Claude Code の `.mcp.json` から spawn される
 * @graph-connects mcp-protocol [calls] stdin/stdout で MCP request/response を処理
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { initOtel, shutdownOtel } from "@self/otel";
import { createServer } from "../src/index.js";

async function main(): Promise<void> {
  // OTel は失敗しても致命的ではないので catch して swallow
  try {
    await initOtel({ serviceName: "mcp-ryan-graph" });
  } catch {
    // ignore
  }
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main()
  .catch((e) => {
    process.stderr.write(`mcp-ryan-graph fatal: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await shutdownOtel().catch(() => {
      // shutdown 失敗は無視
    });
  });
