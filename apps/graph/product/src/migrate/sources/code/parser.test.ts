/**
 * `parser.ts` の unit test (in-memory ts-morph + temp glob)。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business parseConnectsComment / applyGraphTag / hasMeaningfulTags / extractDeclarationsFromFile / findFilesWithGraphTags / parseJSDocExports の純粋ロジックを in-memory FS と temp dir で網羅
 * @graph-connects none
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Project } from "ts-morph";
import {
  applyGraphTag,
  extractDeclarationsFromFile,
  extractFileTags,
  findFilesWithGraphTags,
  hasMeaningfulTags,
  mergeFileTags,
  parseConnectsComment,
  parseJSDocExports,
  type ParsedGraphTags,
} from "./parser.js";

function emptyTags(): ParsedGraphTags {
  return { nodeType: null, stack: null, domains: [], business: null, connects: [] };
}

describe("parseConnectsComment", () => {
  it('returns sentinel for "none"', () => {
    expect(parseConnectsComment("none")).toEqual({
      target: "none",
      relationship: "none",
      cardinality: null,
      via: null,
      description: "",
    });
  });

  it("parses target [rel] description", () => {
    expect(parseConnectsComment("bigquery [reads_from] BQ から SELECT")).toEqual({
      target: "bigquery",
      relationship: "reads_from",
      cardinality: null,
      via: null,
      description: "BQ から SELECT",
    });
  });

  it("parses cardinality + via in brackets", () => {
    const r = parseConnectsComment("svc [calls,many,via:http] 説明");
    expect(r).toEqual({
      target: "svc",
      relationship: "calls",
      cardinality: "many",
      via: "http",
      description: "説明",
    });
  });

  it("returns null on malformed input", () => {
    expect(parseConnectsComment("just a comment")).toBeNull();
    expect(parseConnectsComment("missing brackets here")).toBeNull();
  });
});

describe("applyGraphTag", () => {
  it("graph-node sets nodeType (with or without curly braces)", () => {
    const t1 = emptyTags();
    applyGraphTag(t1, "graph-node", "{Function}");
    expect(t1.nodeType).toBe("Function");
    const t2 = emptyTags();
    applyGraphTag(t2, "graph-node", "Class");
    expect(t2.nodeType).toBe("Class");
  });

  it("graph-stack strips curly braces", () => {
    const t = emptyTags();
    applyGraphTag(t, "graph-stack", "{core}");
    expect(t.stack).toBe("core");
  });

  it("graph-domain splits comma-separated and trims", () => {
    const t = emptyTags();
    applyGraphTag(t, "graph-domain", " graph , infra ");
    expect(t.domains).toEqual(["graph", "infra"]);
  });

  it("graph-business stores raw comment", () => {
    const t = emptyTags();
    applyGraphTag(t, "graph-business", "X account ingest pipeline");
    expect(t.business).toBe("X account ingest pipeline");
  });

  it("graph-connects appends parsed entry; malformed is skipped", () => {
    const t = emptyTags();
    applyGraphTag(t, "graph-connects", "bq [reads_from] desc");
    applyGraphTag(t, "graph-connects", "garbage line");
    expect(t.connects).toHaveLength(1);
    expect(t.connects[0].target).toBe("bq");
  });

  it("ignores unknown tag names silently", () => {
    const t = emptyTags();
    applyGraphTag(t, "graph-unknown", "x");
    expect(t).toEqual(emptyTags());
  });

  it("graph-node with empty comment leaves nodeType null", () => {
    const t = emptyTags();
    applyGraphTag(t, "graph-node", "");
    expect(t.nodeType).toBeNull();
  });

  it("parseConnectsComment with multiple non-via parts only takes last as cardinality", () => {
    const r = parseConnectsComment("svc [calls,1,many] desc");
    expect(r?.cardinality).toBe("many");
  });

  it("parseConnectsComment with trailing empty part is ignored (no cardinality)", () => {
    // 'svc [rel,] desc' → parts = ['rel', ''] → empty part skipped
    const r = parseConnectsComment("svc [rel,] desc");
    expect(r?.cardinality).toBeNull();
    expect(r?.via).toBeNull();
  });
});

describe("extractDeclarationsFromFile JSDoc edge cases", () => {
  function inMemoryFile(name: string, src: string) {
    const project = new Project({ useInMemoryFileSystem: true });
    return project.createSourceFile(name, src);
  }

  it("handles bare @graph-business (no comment text) gracefully", () => {
    // ts-morph の getCommentText() が undefined を返すケース
    const src = `
/**
 * @graph-business
 * @graph-connects bq [reads_from] desc
 */
export function foo() {}
`;
    const out = extractDeclarationsFromFile(inMemoryFile("a.ts", src), "a.ts");
    expect(out).toHaveLength(1);
    // business は空文字列扱い (undefined ではない)
    expect(out[0].tags.business === "" || out[0].tags.business === null).toBe(true);
    expect(out[0].tags.connects).toHaveLength(1);
  });
});

describe("hasMeaningfulTags", () => {
  it("returns false for empty tags", () => {
    expect(hasMeaningfulTags(emptyTags())).toBe(false);
  });

  it("returns true when any field is set", () => {
    expect(hasMeaningfulTags({ ...emptyTags(), business: "x" })).toBe(true);
    expect(hasMeaningfulTags({ ...emptyTags(), domains: ["graph"] })).toBe(true);
    expect(
      hasMeaningfulTags({
        ...emptyTags(),
        connects: [
          { target: "x", relationship: "y", cardinality: null, via: null, description: "" },
        ],
      }),
    ).toBe(true);
  });
});

describe("extractFileTags", () => {
  it("returns empty tags when no leading JSDoc", () => {
    expect(extractFileTags("export const x = 1;\n")).toEqual({
      nodeType: null,
      stack: null,
      domains: [],
      business: null,
      connects: [],
    });
  });

  it("extracts @graph-stack / @graph-domain / @graph-business / @graph-connects", () => {
    const src = `/**
 * comment
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business 概要文
 * @graph-connects bigquery [reads_from] foo
 */
import x from 'y';\n`;
    const t = extractFileTags(src);
    expect(t.stack).toBe("core");
    expect(t.domains).toEqual(["infra"]);
    expect(t.business).toBe("概要文");
    expect(t.connects).toHaveLength(1);
    expect(t.connects[0].target).toBe("bigquery");
  });

  it("only reads the first JSDoc block (subsequent JSDocs ignored)", () => {
    const src = `/**
 * @graph-stack core
 */
const x = 1;
/**
 * @graph-stack other
 */`;
    expect(extractFileTags(src).stack).toBe("core");
  });
});

describe("mergeFileTags", () => {
  it("declaration tags take precedence; file tags fill the rest", () => {
    const file: ParsedGraphTags = {
      nodeType: null,
      stack: "core",
      domains: ["infra"],
      business: "file-level",
      connects: [
        { target: "x", relationship: "y", cardinality: null, via: null, description: "f" },
      ],
    };
    const decl: ParsedGraphTags = {
      nodeType: "Function",
      stack: null,
      domains: [],
      business: null,
      connects: [
        { target: "z", relationship: "w", cardinality: null, via: null, description: "d" },
      ],
    };
    const merged = mergeFileTags(decl, file);
    expect(merged.nodeType).toBe("Function");
    expect(merged.stack).toBe("core");
    expect(merged.domains).toEqual(["infra"]);
    expect(merged.business).toBe("file-level");
    // connects は declaration only (継承しない)
    expect(merged.connects).toHaveLength(1);
    expect(merged.connects[0].target).toBe("z");
  });
});

describe("extractDeclarationsFromFile (ts-morph in-memory)", () => {
  function inMemoryFile(name: string, src: string) {
    const project = new Project({ useInMemoryFileSystem: true });
    return project.createSourceFile(name, src);
  }

  it("extracts function with @graph-business + @graph-connects", () => {
    const src = `
/**
 * @graph-business test fn
 * @graph-connects bq [reads_from] foo
 */
export function foo() {}
`;
    const out = extractDeclarationsFromFile(inMemoryFile("a.ts", src), "a.ts");
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("foo");
    expect(out[0].isExported).toBe(true);
    expect(out[0].tags.business).toBe("test fn");
    expect(out[0].tags.connects).toHaveLength(1);
  });

  it("extracts variable declaration (const) and respects export flag", () => {
    const src = `
/** @graph-business v */
const x = 1;
/** @graph-business e */
export const y = 2;
`;
    const out = extractDeclarationsFromFile(inMemoryFile("a.ts", src), "a.ts");
    const map = Object.fromEntries(out.map((o) => [o.name, o]));
    expect(map.x.isExported).toBe(false);
    expect(map.y.isExported).toBe(true);
  });

  it("extracts class + class methods (className.method as name)", () => {
    const src = `
/** @graph-business cls */
export class Foo {
  /** @graph-business m */
  bar() {}
}
`;
    const out = extractDeclarationsFromFile(inMemoryFile("a.ts", src), "a.ts");
    const names = out.map((o) => o.name).sort();
    expect(names).toEqual(["Foo", "Foo.bar"]);
  });

  it("extracts interface / type-alias / enum", () => {
    const src = `
/** @graph-business i */
export interface I {}
/** @graph-business t */
export type T = string;
/** @graph-business e */
export enum E { A }
`;
    const out = extractDeclarationsFromFile(inMemoryFile("a.ts", src), "a.ts");
    expect(out.map((o) => o.name).sort()).toEqual(["E", "I", "T"]);
  });

  it("extracts export default expression with name = expression text", () => {
    const src = `
const app = 1;
/** @graph-business d */
export default app;
`;
    const out = extractDeclarationsFromFile(inMemoryFile("a.ts", src), "a.ts");
    const ed = out.find((o) => o.tags.business === "d");
    expect(ed).toBeDefined();
    expect(ed!.isExported).toBe(true);
    expect(ed!.name).toBe("app");
  });

  it("extracts new-expression statement with literal first arg as name", () => {
    const src = `
/** @graph-business cron daily */
new gcp.cloudscheduler.Job("graph-migrate-daily", {});
`;
    const out = extractDeclarationsFromFile(inMemoryFile("a.ts", src), "a.ts");
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("graph-migrate-daily");
  });

  it("falls back to expr_<line> when new-expression has no literal arg", () => {
    const src = `
/** @graph-business x */
new Foo();
`;
    const out = extractDeclarationsFromFile(inMemoryFile("a.ts", src), "a.ts");
    expect(out).toHaveLength(1);
    expect(out[0].name).toMatch(/^expr_\d+$/);
  });

  it("skips declarations without meaningful tags", () => {
    const src = `
export function noTags() {}
/** @graph-business has */
export function withTags() {}
`;
    const out = extractDeclarationsFromFile(inMemoryFile("a.ts", src), "a.ts");
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("withTags");
  });

  it("uses 'anonymous' for unnamed function / class", () => {
    const src = `
/** @graph-business anonFn */
export default function () {}
/** @graph-business anonCls */
export default class {}
`;
    const out = extractDeclarationsFromFile(inMemoryFile("a.ts", src), "a.ts");
    const names = out.map((o) => o.name).sort();
    expect(names).toContain("anonymous");
  });

  it("skips ExpressionStatement without graph-* tags", () => {
    const src = `
new SomeClass();
/** @graph-business x */
new TaggedClass("name");
`;
    const out = extractDeclarationsFromFile(inMemoryFile("a.ts", src), "a.ts");
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("name");
  });

  it("skips export = (export equals) syntax", () => {
    // export = は CommonJS-style、graph-* タグつけても無視される
    const src = `
const m = 1;
/** @graph-business should-skip */
export = m;
`;
    const out = extractDeclarationsFromFile(inMemoryFile("a.ts", src), "a.ts");
    expect(out).toHaveLength(0);
  });

  it("inherits file-level stack/domain/business when fileTags is provided", () => {
    const src = `/** @graph-connects none */
export function foo() {}\n`;
    const sf = inMemoryFile("a.ts", src);
    const fileTags: ParsedGraphTags = {
      nodeType: null,
      stack: "core",
      domains: ["infra"],
      business: "file-business",
      connects: [],
    };
    const out = extractDeclarationsFromFile(sf, "a.ts", fileTags);
    expect(out).toHaveLength(1);
    expect(out[0].tags.stack).toBe("core");
    expect(out[0].tags.business).toBe("file-business");
    expect(out[0].tags.domains).toEqual(["infra"]);
  });
});

describe("findFilesWithGraphTags + parseJSDocExports (temp dir)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "parser-test-"));
    mkdirSync(join(tmp, "apps/x/src"), { recursive: true });
    writeFileSync(
      join(tmp, "apps/x/src/with.ts"),
      `/** @graph-business hi */\nexport function hi() {}\n`,
    );
    writeFileSync(join(tmp, "apps/x/src/without.ts"), `export function plain() {}\n`);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("findFilesWithGraphTags filters out files without @graph-* markers", async () => {
    const files = await findFilesWithGraphTags(["apps/**/src/**/*.ts"], tmp);
    expect(files).toHaveLength(1);
    expect(files[0].endsWith("with.ts")).toBe(true);
  });

  it("parseJSDocExports returns ParsedExport array for tagged file only", async () => {
    const out = await parseJSDocExports(tmp, ["apps/**/src/**/*.ts"]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("hi");
    expect(out[0].filePath).toBe("apps/x/src/with.ts");
    expect(out[0].tags.business).toBe("hi");
  });

  it("parseJSDocExports respects custom chunkSize (still produces same result)", async () => {
    const out = await parseJSDocExports(tmp, ["apps/**/src/**/*.ts"], 1);
    expect(out).toHaveLength(1);
  });
});
