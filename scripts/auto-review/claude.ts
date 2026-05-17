/**
 * `claude -p` を spawn し、stdout を集約 + body / verdict を抽出する。
 *
 * - cwd は worktree、`--dangerously-skip-permissions` 付き
 * - timeout: default 30 分 (env `CLAUDE_TIMEOUT_MS` で override)
 * - 終了時は exitCode と timedOut を返す。stdout はそのまま渡す
 * - **stdout / stderr / prompt は逐次 log file に書き出す** (`logFile` 指定時)。
 *   parse 失敗 (marker 不在等) の debug で「Claude が実際に何を吐いたか」を確認するため必須。
 *   in-memory に持つ stdout 文字列とは独立して log file に記録するので、stream 中断 / parse 失敗
 *   の何れでも復元可能
 *
 * MCP 設定:
 *   - worktree 直下に `.mcp.json` (worktree.ts が repo root から copy) が存在すれば、
 *     `--mcp-config <path>` で明示的に load する。これにより project-scope MCP の trust dialog
 *     (非対話 -p mode でも MCP server 個別承認は通常残る) を bypass し、ryan-graph / xmcp-* /
 *     grafana-personal 等が claude session で使えるようになる。user-scope MCP (cortex-* /
 *     service-product-graph) は `~/.claude.json` から自動的に additive で load される
 *     (`--strict-mcp-config` は付けない)。
 *
 * TURBO_CACHE_DIR:
 *   - turbo の cache dir を `~/.cache/self-management-auto-review/turbo-cache` に固定する。
 *     bot が作る worktree は毎回別 path なので、default の `node_modules/.cache/turbo` だと
 *     cold cache で build / test を毎回フル実行 → 1 session ~3-5 分の重荷。共有 path にすれば
 *     turbo が content hash で再利用するので review / fix 系の 6 gate 実行が大幅に短縮される。
 *     既存 env `TURBO_CACHE_DIR` が呼出側にあれば尊重する (env override)
 */

import { spawn } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface ClaudeRunInput {
  prompt: string;
  cwd: string;
  timeoutMs?: number;
  /** stdout / stderr / prompt をこの path に log として書き出す。指定無しなら disable。 */
  logFile?: string;
}

export interface ClaudeRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  /** logFile が指定されていた場合のその path (caller が user に提示する用)。 */
  logFile?: string;
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

/** turbo cache の共有 path。HOME 配下に置いて worktree 跨ぎで再利用する。 */
export const SHARED_TURBO_CACHE_DIR = join(
  homedir(),
  ".cache",
  "self-management-auto-review",
  "turbo-cache",
);

/** Claude CLI を 1 ショット実行する。 */
export function runClaude(input: ClaudeRunInput): Promise<ClaudeRunResult> {
  return new Promise((resolve, reject) => {
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let logFd: number | null = null;
    if (input.logFile) {
      mkdirSync(dirname(input.logFile), { recursive: true });
      logFd = openSync(input.logFile, "a");
      const header = [
        `# claude -p log`,
        `# cwd: ${input.cwd}`,
        `# timeoutMs: ${timeoutMs}`,
        `# startedAt: ${new Date().toISOString()}`,
        `# prompt (${input.prompt.length} chars):`,
        input.prompt
          .split("\n")
          .map((l) => `# > ${l}`)
          .join("\n"),
        `# --- stdout / stderr below ---`,
        "",
      ].join("\n");
      appendFileSync(logFd, header);
    }
    const args = ["-p", input.prompt, "--dangerously-skip-permissions"];
    // worktree.ts が copy した .mcp.json を明示 load (--mcp-config は trust 不要で load + user-scope と additive)
    const mcpConfigPath = join(input.cwd, ".mcp.json");
    if (existsSync(mcpConfigPath)) {
      args.push("--mcp-config", mcpConfigPath);
    }
    // env: turbo cache は session 跨ぎで共有させたいので shared path を inject
    // (caller が TURBO_CACHE_DIR を既に設定していればそれを優先)
    mkdirSync(SHARED_TURBO_CACHE_DIR, { recursive: true });
    const env = {
      ...process.env,
      TURBO_CACHE_DIR: process.env.TURBO_CACHE_DIR ?? SHARED_TURBO_CACHE_DIR,
    };
    const child = spawn("claude", args, {
      cwd: input.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000);
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (logFd !== null) appendFileSync(logFd, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (logFd !== null) appendFileSync(logFd, chunk);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      if (logFd !== null) {
        appendFileSync(logFd, `\n# spawn error: ${err.message}\n`);
        try {
          closeSync(logFd);
        } catch {
          // ignore — log fd cleanup best-effort
        }
      }
      reject(err);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      if (logFd !== null) {
        appendFileSync(
          logFd,
          `\n# --- end (exitCode=${exitCode}, timedOut=${timedOut}, finishedAt=${new Date().toISOString()}) ---\n`,
        );
        try {
          closeSync(logFd);
        } catch {
          // ignore — log fd cleanup best-effort
        }
      }
      resolve({ stdout, stderr, exitCode, timedOut, logFile: input.logFile });
    });
  });
}

const BODY_START = "<!-- AUTO_REVIEW_BODY_START -->";
const BODY_END = "<!-- AUTO_REVIEW_BODY_END -->";

export type Verdict = "REQUEST_CHANGES" | "APPROVE" | "NO_OP";

export interface ParsedReviewOutput {
  body: string | null;
  verdict: Verdict | null;
  fixFailedReason: string | null;
}

/** stdout から body / verdict / fix failed reason を抽出 (pure)。 */
export function parseReviewOutput(stdout: string): ParsedReviewOutput {
  const startIdx = stdout.indexOf(BODY_START);
  const endIdx = stdout.indexOf(BODY_END);
  const body =
    startIdx !== -1 && endIdx !== -1 && endIdx > startIdx
      ? stdout.slice(startIdx + BODY_START.length, endIdx).trim()
      : null;

  let verdict: Verdict | null = null;
  if (stdout.includes("<!-- VERDICT:NO_OP -->")) verdict = "NO_OP";
  else if (stdout.includes("<!-- VERDICT:REQUEST_CHANGES -->")) verdict = "REQUEST_CHANGES";
  else if (stdout.includes("<!-- VERDICT:APPROVE -->")) verdict = "APPROVE";

  const fixFailedMatch = stdout.match(/<!--\s*FIX_FAILED:([^>]*?)\s*-->/);
  const fixFailedReason = fixFailedMatch ? fixFailedMatch[1].trim() : null;

  return { body, verdict, fixFailedReason };
}

/** 投稿用に body と verdict marker を bot コメント形式に組み立てる。 */
export function buildBotCommentBody(body: string, verdict: Verdict): string {
  return [BODY_START, body.trim(), BODY_END, `<!-- VERDICT:${verdict} -->`].join("\n");
}
