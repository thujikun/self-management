/**
 * `claude -p` を spawn し、stdout を集約 + body / verdict を抽出する。
 *
 * - cwd は worktree、`--dangerously-skip-permissions` 付き
 * - timeout: default 30 分 (env `CLAUDE_TIMEOUT_MS` で override)
 * - 終了時は exitCode と timedOut を返す。stdout はそのまま渡す
 */

import { spawn } from "node:child_process";

export interface ClaudeRunInput {
  prompt: string;
  cwd: string;
  timeoutMs?: number;
}

export interface ClaudeRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

/** Claude CLI を 1 ショット実行する。 */
export function runClaude(input: ClaudeRunInput): Promise<ClaudeRunResult> {
  return new Promise((resolve, reject) => {
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const child = spawn("claude", ["-p", input.prompt, "--dangerously-skip-permissions"], {
      cwd: input.cwd,
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
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode, timedOut });
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
