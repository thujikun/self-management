/**
 * `check-line-count.ts` の countCodeLines unit tests。
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business 行数 cap guard の純粋ロジック (countCodeLines) のテスト。空行除外、行コメント (// / #)、ブロックコメント (multi-line / single-line)、JSDoc 行、shell コメントなどあらゆるコメント形態を除外する挙動を網羅
 * @graph-connects none
 */

import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { countCodeLines, runLineCountCheck } from "./check-line-count.js";

describe("countCodeLines", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "linecount-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function write(name: string, content: string): Promise<string> {
    const p = join(dir, name);
    await writeFile(p, content, "utf8");
    return p;
  }

  it("存在しないファイル → 0", () => {
    expect(countCodeLines(join(dir, "no-such-file.ts"))).toBe(0);
  });

  it("空ファイル → 0", async () => {
    const p = await write("empty.ts", "");
    expect(countCodeLines(p)).toBe(0);
  });

  it("空行のみ → 0", async () => {
    const p = await write("blank.ts", "\n\n\n   \n");
    expect(countCodeLines(p)).toBe(0);
  });

  it("単純なコード行のみ → コード行数", async () => {
    const p = await write("a.ts", "const a = 1;\nconst b = 2;\n");
    expect(countCodeLines(p)).toBe(2);
  });

  it("行コメント (//) は除外", async () => {
    const p = await write(
      "b.ts",
      ["// header", "const a = 1;", "// trailing", "const b = 2;"].join("\n"),
    );
    expect(countCodeLines(p)).toBe(2);
  });

  it("複数行ブロックコメント (/* ... */) は除外", async () => {
    const p = await write(
      "c.ts",
      ["/*", " * a multi-line", " * comment", " */", "const a = 1;"].join("\n"),
    );
    expect(countCodeLines(p)).toBe(1);
  });

  it("単行ブロックコメント (/* ... */) は除外", async () => {
    const p = await write("d.ts", ["/* single */", "const a = 1;"].join("\n"));
    expect(countCodeLines(p)).toBe(1);
  });

  it("JSDoc (/**) も除外", async () => {
    const p = await write(
      "e.ts",
      ["/**", " * description", " * @graph-connects none", " */", "export function f() {}"].join(
        "\n",
      ),
    );
    expect(countCodeLines(p)).toBe(1);
  });

  it(".sh は # を行コメントとして扱う", async () => {
    const p = await write("x.sh", ["#!/bin/bash", "# comment", "echo hello"].join("\n"));
    expect(countCodeLines(p)).toBe(1);
  });

  it(".py も # を行コメントとして扱う", async () => {
    const p = await write("x.py", ["# comment", "x = 1"].join("\n"));
    expect(countCodeLines(p)).toBe(1);
  });

  it("ts では # は除外しない (コード行扱い)", async () => {
    const p = await write("x.ts", "# this is invalid TS but counts as code\n");
    expect(countCodeLines(p)).toBe(1);
  });

  it("ブロックコメント中の // は除外、終端後はコード行", async () => {
    const p = await write("f.ts", ["/*", "// inside block", "*/", "const a = 1;"].join("\n"));
    expect(countCodeLines(p)).toBe(1);
  });
});

describe("runLineCountCheck", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "linecount-run-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("CAP 内のファイルのみ → 0 failure", async () => {
    const p = join(dir, "ok.ts");
    await writeFile(p, "const a = 1;\n", "utf8");
    expect(runLineCountCheck([p], 500)).toBe(0);
  });

  it("CAP 超過 → failure 件数を返す + console.error 出力", async () => {
    const p = join(dir, "big.ts");
    const src = Array.from({ length: 12 }, (_, i) => `const x${i} = ${i};`).join("\n");
    await writeFile(p, src, "utf8");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = runLineCountCheck([p], 5); // CAP=5、12 行で超過
    expect(failed).toBe(1);
    // エラーメッセージにファイル名と "code lines" / "cap" が含まれる
    expect(errSpy).toHaveBeenCalled();
    const allCalls = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allCalls).toContain("big.ts");
    expect(allCalls).toContain("cap=5");
    errSpy.mockRestore();
  });

  it("対象拡張子以外は filter で除外", async () => {
    const p = join(dir, "huge.md");
    await writeFile(p, Array(1000).fill("foo").join("\n"), "utf8");
    expect(runLineCountCheck([p], 5)).toBe(0);
  });

  it("複数ファイルで一部 fail", async () => {
    const ok = join(dir, "ok.ts");
    const bad = join(dir, "bad.ts");
    await writeFile(ok, "const a = 1;\n", "utf8");
    await writeFile(
      bad,
      Array.from({ length: 12 }, (_, i) => `const x${i}=${i};`).join("\n"),
      "utf8",
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = runLineCountCheck([ok, bad], 5);
    expect(failed).toBe(1);
    errSpy.mockRestore();
  });
});
