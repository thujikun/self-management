/**
 * worktree.ts の `copyMcpConfig` 単体 test。git 操作 (`createBranchWorktree` /
 * `createReadOnlyWorktree`) は real git に依存するため統合テスト側に委ね、ここでは file copy の
 * happy / ENOENT / 他の error path のみ assertion する。
 */

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { copyMcpConfig } from "./worktree.js";

describe("copyMcpConfig", () => {
  let workDir: string;
  let repoRoot: string;
  let worktreePath: string;
  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "auto-review-worktree-test-"));
    repoRoot = join(workDir, "repo");
    worktreePath = join(workDir, "wt");
    await mkdir(repoRoot, { recursive: true });
    await mkdir(worktreePath, { recursive: true });
  });
  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("source の .mcp.json が存在 → worktree に copy される (内容一致)", async () => {
    const body = JSON.stringify({ mcpServers: { foo: { type: "stdio" } } }, null, 2);
    await writeFile(join(repoRoot, ".mcp.json"), body, "utf8");
    await copyMcpConfig(repoRoot, worktreePath);
    const copied = await readFile(join(worktreePath, ".mcp.json"), "utf8");
    expect(copied).toStrictEqual(body);
  });

  it("source の .mcp.json が無い (ENOENT) → silent 完走、worktree には何も置かない", async () => {
    await copyMcpConfig(repoRoot, worktreePath);
    await expect(stat(join(worktreePath, ".mcp.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("worktree 側に既存 .mcp.json があっても上書きする (重複 copy で fail しない)", async () => {
    await writeFile(join(repoRoot, ".mcp.json"), '{"version":2}', "utf8");
    await writeFile(join(worktreePath, ".mcp.json"), '{"version":1}', "utf8");
    await copyMcpConfig(repoRoot, worktreePath);
    const copied = await readFile(join(worktreePath, ".mcp.json"), "utf8");
    expect(copied).toStrictEqual('{"version":2}');
  });
});
