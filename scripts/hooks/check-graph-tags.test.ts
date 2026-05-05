/**
 * `check-graph-tags.ts` の pure helper unit tests。
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business @graph-* タグ整合 guard のテスト。extractFileJsdoc / checkFileLevelTags / checkDeclarationConnects の各検証ロジックを網羅し、必須タグの欠落・stack/domain enum 違反・declaration の @graph-connects 不在を漏れなく弾けることを確認
 * @graph-connects none
 */

import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkDeclarationConnects,
  checkFileLevelTags,
  extractFileJsdoc,
  runGraphTagsCheck,
  type FileError,
} from "./check-graph-tags.js";

describe("extractFileJsdoc", () => {
  it("先頭 JSDoc がない → null", () => {
    expect(extractFileJsdoc("const a = 1;")).toBeNull();
  });

  it("先頭 JSDoc から @graph-* タグを Map 化", () => {
    const src = `/**
 * desc
 * @graph-stack core
 * @graph-domain infra
 * @graph-business something
 * @graph-connects none
 */
const a = 1;`;
    const tags = extractFileJsdoc(src);
    expect(tags).toEqual({
      "graph-stack": "core",
      "graph-domain": "infra",
      "graph-business": "something",
      "graph-connects": "none",
    });
  });

  it("JSDoc が空タグなら空 record", () => {
    const src = "/**\n * just text\n */\nconst a = 1;";
    expect(extractFileJsdoc(src)).toEqual({});
  });
});

describe("checkFileLevelTags", () => {
  it("JSDoc 不在 → 1 error", () => {
    const errors: FileError[] = [];
    checkFileLevelTags("a.ts", "const a=1;", errors);
    expect(errors).toHaveLength(1);
    expect(errors[0].msg).toContain("missing file-level JSDoc");
  });

  it("必須タグ欠落 → 各 1 error", () => {
    const errors: FileError[] = [];
    const src = `/**
 * just description, no graph tags
 */
const a = 1;`;
    checkFileLevelTags("a.ts", src, errors);
    const msgs = errors.map((e) => e.msg).join(" | ");
    expect(msgs).toContain("@graph-stack");
    expect(msgs).toContain("@graph-domain");
    expect(msgs).toContain("@graph-business");
    expect(msgs).toContain("@graph-connects");
  });

  it("未登録 stack → error", () => {
    const errors: FileError[] = [];
    const src = `/**
 * @graph-stack unknown-stack
 * @graph-domain infra
 * @graph-business desc
 * @graph-connects none
 */
const a = 1;`;
    checkFileLevelTags("a.ts", src, errors);
    expect(errors.some((e) => e.msg.includes("unknown @graph-stack"))).toBe(true);
  });

  it("未登録 domain → error", () => {
    const errors: FileError[] = [];
    const src = `/**
 * @graph-stack core
 * @graph-domain unknown-domain
 * @graph-business desc
 * @graph-connects none
 */
const a = 1;`;
    checkFileLevelTags("a.ts", src, errors);
    expect(errors.some((e) => e.msg.includes("unknown @graph-domain"))).toBe(true);
  });

  it("全部 OK → 0 error", () => {
    const errors: FileError[] = [];
    const src = `/**
 * @graph-stack core
 * @graph-domain infra
 * @graph-business desc
 * @graph-connects none
 */
const a = 1;`;
    checkFileLevelTags("a.ts", src, errors);
    expect(errors).toEqual([]);
  });
});

describe("checkDeclarationConnects", () => {
  it("`/** @graph-connects none */` 直前付き宣言 → 0 error", () => {
    const errors: FileError[] = [];
    const src = `/** @graph-connects none */
export const a = 1;
/** @graph-connects none */
function f() {}
`;
    checkDeclarationConnects("a.ts", src, errors);
    expect(errors).toEqual([]);
  });

  it("コメントなし宣言 → error", () => {
    const errors: FileError[] = [];
    checkDeclarationConnects("a.ts", "export const a = 1;\n", errors);
    expect(errors).toHaveLength(1);
    expect(errors[0].msg).toContain("missing @graph-connects");
  });

  it("type / interface / enum は対象外", () => {
    const errors: FileError[] = [];
    const src = `export type T = string;
export interface I { a: string }
export enum E { A, B }
`;
    checkDeclarationConnects("a.ts", src, errors);
    expect(errors).toEqual([]);
  });

  it("複数宣言で 1 つだけ抜けている", () => {
    const errors: FileError[] = [];
    const src = `/** @graph-connects none */
export const a = 1;
export const b = 2;
`;
    checkDeclarationConnects("a.ts", src, errors);
    expect(errors).toHaveLength(1);
    expect(errors[0].msg).toContain('"b"');
  });

  it("行コメント (//) でも認識する", () => {
    const errors: FileError[] = [];
    const src = `// @graph-connects none
const x = 1;
`;
    checkDeclarationConnects("a.ts", src, errors);
    expect(errors).toEqual([]);
  });

  it("ブロック JSDoc 内に @graph-connects があれば OK", () => {
    const errors: FileError[] = [];
    const src = `/**
 * desc
 * @graph-connects none
 */
export function f() {}
`;
    checkDeclarationConnects("a.ts", src, errors);
    expect(errors).toEqual([]);
  });
});

describe("runGraphTagsCheck (file-path filter integration)", () => {
  // テストでは実ファイルが必要なので tmpdir に project 構造を再現
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "graphtags-test-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function write(rel: string, src: string): Promise<string> {
    const path = join(root, rel);
    const dir = path.substring(0, path.lastIndexOf("/"));
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    const { mkdir } = await import("node:fs/promises");
    await mkdir(dir, { recursive: true });
    await writeFile(path, src, "utf8");
    return path;
  }

  it("apps/ 配下の TS ファイルが対象。tags 完備なら 0 error", async () => {
    process.chdir(root);
    await write(
      "apps/x/src/file.ts",
      `/**
 * @graph-stack core
 * @graph-domain infra
 * @graph-business desc
 * @graph-connects none
 */
/** @graph-connects none */
export const a = 1;
`,
    );
    const errors = runGraphTagsCheck(["apps/x/src/file.ts"]);
    expect(errors).toEqual([]);
  });

  it("apps/ 外 (例: docs/) のファイルは対象外なので素通り", async () => {
    process.chdir(root);
    await write("docs/readme.ts", "const a = 1;\n");
    const errors = runGraphTagsCheck(["docs/readme.ts"]);
    expect(errors).toEqual([]);
  });

  it("test ファイルは対象外", async () => {
    process.chdir(root);
    await write("apps/x/src/foo.test.ts", "const a = 1;\n");
    const errors = runGraphTagsCheck(["apps/x/src/foo.test.ts"]);
    expect(errors).toEqual([]);
  });

  it("apps 配下で違反があれば error 配列を返す", async () => {
    process.chdir(root);
    await write(
      "apps/x/src/bad.ts",
      "export const a = 1;\n", // tags 全くなし
    );
    const errors = runGraphTagsCheck(["apps/x/src/bad.ts"]);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("存在しないファイル path は無視", async () => {
    process.chdir(root);
    const errors = runGraphTagsCheck(["apps/x/src/missing.ts"]);
    expect(errors).toEqual([]);
  });
});
