/**
 * `gh` CLI を spawn する共通ヘルパ。
 *
 * `runGhCapture` は stdout / stderr を両方 capture し、exit !=0 で stderr を含めた Error を投げる。
 * merge-job (merge / update-branch) や update-branch-job が「失敗 stderr 文言で原因判別する」
 * 用途で使っており、同じ実装を 2 箇所に持つと仕様変更 (timeout / `--rebase` flag 等) 時に
 * 同期が必要になるため切り出した。
 *
 * `ghUpdateBranch` は `gh pr update-branch <N>` の wrapper。merge-job (out-of-date 復旧) と
 * update-branch-job (proactive 更新) の両方から呼ばれる。
 */

import { spawn } from "node:child_process";

/**
 * gh CLI を spawn し stdout / stderr を両方 capture。
 * 失敗時 (exit !=0) は Error.message に stderr を含めて投げる。エラー文言で原因判別する呼び出し側のため。
 */
export function runGhCapture(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("gh", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const tail = (stderr.trim() || stdout.trim()).slice(-500);
        reject(new Error(`gh ${args.join(" ")} exit ${code}\n${tail}`));
      }
    });
  });
}

/** `gh pr update-branch <N>` で PR branch に base を取り込み up-to-date 化 (default: merge)。 */
export async function ghUpdateBranch(repo: string, prNumber: number): Promise<void> {
  await runGhCapture(["pr", "update-branch", String(prNumber), "--repo", repo]);
}
