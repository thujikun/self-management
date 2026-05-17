/**
 * gh-cli.ts の test。gh CLI 実バイナリを spawn しない方針で、`node:child_process.spawn` を vi.mock で差し替える。
 * - 成功 path: exit 0 で `{ stdout, stderr }` resolve
 * - 失敗 path: exit !=0 で stderr 含む Error を reject
 * - `ghUpdateBranch` が正しい args を組み立てる
 */

import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

interface FakeChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
}

function makeFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

function feedAndClose(
  child: FakeChild,
  parts: { stdout?: string; stderr?: string; code: number },
): void {
  if (parts.stdout) child.stdout.emit("data", Buffer.from(parts.stdout, "utf8"));
  if (parts.stderr) child.stderr.emit("data", Buffer.from(parts.stderr, "utf8"));
  child.emit("close", parts.code);
}

describe("runGhCapture", () => {
  it("exit 0: stdout / stderr 両方 capture して resolve", async () => {
    const { runGhCapture } = await import("./gh-cli.js");
    const child = makeFakeChild();
    spawnMock.mockReturnValueOnce(child);
    const p = runGhCapture(["pr", "list", "--repo", "x/y"]);
    feedAndClose(child, { stdout: "ok-out", stderr: "warn-err", code: 0 });
    await expect(p).resolves.toStrictEqual({ stdout: "ok-out", stderr: "warn-err" });
    expect(spawnMock).toHaveBeenCalledWith("gh", ["pr", "list", "--repo", "x/y"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  });

  it("exit !=0: stderr を含む Error を reject (stderr が tail に出る)", async () => {
    const { runGhCapture } = await import("./gh-cli.js");
    const child = makeFakeChild();
    spawnMock.mockReturnValueOnce(child);
    const p = runGhCapture(["pr", "merge", "33"]);
    feedAndClose(child, { stderr: "X cannot merge: branch protected", code: 1 });
    await expect(p).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: gh pr merge 33 exit 1\nX cannot merge: branch protected]`,
    );
  });

  it("exit !=0 + stderr 空: stdout を tail にして reject", async () => {
    const { runGhCapture } = await import("./gh-cli.js");
    const child = makeFakeChild();
    spawnMock.mockReturnValueOnce(child);
    const p = runGhCapture(["pr", "view", "33"]);
    feedAndClose(child, { stdout: "auth required", code: 2 });
    await expect(p).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: gh pr view 33 exit 2\nauth required]`,
    );
  });

  it("child の `error` event は reject に伝播する (spawn 失敗 / ENOENT)", async () => {
    const { runGhCapture } = await import("./gh-cli.js");
    const child = makeFakeChild();
    spawnMock.mockReturnValueOnce(child);
    const p = runGhCapture(["pr", "list"]);
    child.emit("error", new Error("ENOENT gh not found"));
    await expect(p).rejects.toThrowErrorMatchingInlineSnapshot(`[Error: ENOENT gh not found]`);
  });
});

describe("ghUpdateBranch", () => {
  it("`gh pr update-branch <N> --repo <repo>` を組み立てて呼ぶ", async () => {
    const { ghUpdateBranch } = await import("./gh-cli.js");
    const child = makeFakeChild();
    spawnMock.mockReturnValueOnce(child);
    const p = ghUpdateBranch("thujikun/self-management", 33);
    feedAndClose(child, { code: 0 });
    await p;
    expect(spawnMock).toHaveBeenLastCalledWith(
      "gh",
      ["pr", "update-branch", "33", "--repo", "thujikun/self-management"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
  });

  it("gh が non-zero exit で throw する", async () => {
    const { ghUpdateBranch } = await import("./gh-cli.js");
    const child = makeFakeChild();
    spawnMock.mockReturnValueOnce(child);
    const p = ghUpdateBranch("x/y", 1);
    feedAndClose(child, { stderr: "API rate limit", code: 1 });
    await expect(p).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: gh pr update-branch 1 --repo x/y exit 1\nAPI rate limit]`,
    );
  });
});
