/**
 * `@graph-*` JSDoc tag parser (ts-morph + glob)。
 *
 * cortex の `apps/graph/product/src/parsers/jsdoc-parser.ts` を移植して、
 * self-management の monorepo 配下 `.ts/.tsx` から:
 *  - ファイル先頭 JSDoc の `@graph-stack` / `@graph-domain` / `@graph-business` / `@graph-connects`
 *  - top-level 宣言 (function / variable / class / interface / type-alias / enum /
 *    export-default / new 式の statement) の JSDoc 内同タグ
 * を抽出して `ParsedExport[]` を返す。
 *
 * v2 (cortex 同型): export-only 縛りは無し、private な const も @graph-* タグがあれば node 化。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business cortex jsdoc-parser を移植したコード→グラフ変換の入口。ts-morph で AST 解析、@graph-* 含むファイルだけ chunk 単位でロードして OOM を回避
 * @graph-connects filesystem [reads_from] mono-repo 配下 .ts/.tsx を ts-morph で読み出し
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { glob } from "glob";
import { Project, SyntaxKind, type Node, type SourceFile } from "ts-morph";

/** `@graph-connects` 1 行のパース結果。 */
export interface ParsedConnectsTag {
  target: string;
  relationship: string;
  cardinality: string | null;
  via: string | null;
  description: string;
}

/** ファイル / 宣言から抽出した graph-* タグ群。 */
export interface ParsedGraphTags {
  nodeType: string | null;
  stack: string | null;
  domains: string[];
  business: string | null;
  connects: ParsedConnectsTag[];
}

/** 1 つの export 相当 (= node 化対象)。 */
export interface ParsedExport {
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  isExported: boolean;
  tags: ParsedGraphTags;
}

/** @graph-connects none */
export const SOURCE_PATTERNS = [
  "apps/**/src/**/*.ts",
  "apps/**/src/**/*.tsx",
  "apps/**/bin/**/*.ts",
  "apps/**/scripts/**/*.ts",
  "packages/**/src/**/*.ts",
  "infra/**/*.ts",
];

/**
 * `target [relationship,cardinality?,via:?] description` 形式 OR `none` を分解。
 *
 * @graph-connects none
 */
export function parseConnectsComment(comment: string): ParsedConnectsTag | null {
  if (comment.trim().toLowerCase() === "none") {
    return { target: "none", relationship: "none", cardinality: null, via: null, description: "" };
  }
  const match = /^(\S+)\s+\[([^\]]+)\]\s*(.*)/.exec(comment);
  if (!match) return null;
  const target = match[1] ?? "";
  const bracketContent = match[2] ?? "";
  const description = match[3]?.trim() ?? "";
  const parts = bracketContent.split(",").map((s) => s.trim());
  let cardinality: string | null = null;
  let via: string | null = null;
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i] ?? "";
    if (part.startsWith("via:")) via = part.slice(4);
    else if (part) cardinality = part;
  }
  return { target, relationship: parts[0] ?? "", cardinality, via, description };
}

/**
 * tag 1 個を `ParsedGraphTags` に書き込む。
 *
 * @graph-connects none
 */
export function applyGraphTag(
  tags: ParsedGraphTags,
  tagName: string,
  comment: string,
): void {
  switch (tagName) {
    case "graph-node": {
      const m = /\{?(\w+)\}?/.exec(comment);
      tags.nodeType = m?.[1] ?? null;
      break;
    }
    case "graph-stack":
      tags.stack = comment.replace(/^\{|\}$/g, "").trim();
      break;
    case "graph-domain": {
      const raw = comment.replace(/^\{|\}$/g, "").trim();
      tags.domains = raw.split(",").map((d) => d.trim()).filter(Boolean);
      break;
    }
    case "graph-business":
      tags.business = comment;
      break;
    case "graph-connects": {
      const p = parseConnectsComment(comment);
      if (p) tags.connects.push(p);
      break;
    }
  }
}

/** @graph-connects none */
function extractTagsFromNode(node: Node): ParsedGraphTags {
  const jsdocs = node.getChildrenOfKind(SyntaxKind.JSDoc);
  const tags: ParsedGraphTags = {
    nodeType: null,
    stack: null,
    domains: [],
    business: null,
    connects: [],
  };
  for (const jsdoc of jsdocs) {
    for (const tag of jsdoc.getTags()) {
      applyGraphTag(tags, tag.getTagName(), tag.getCommentText()?.trim() ?? "");
    }
  }
  return tags;
}

/**
 * 「意味のある」タグが何かしら 1 つでも入っているか。
 *
 * @graph-connects none
 */
export function hasMeaningfulTags(tags: ParsedGraphTags): boolean {
  return (
    tags.nodeType !== null ||
    tags.stack !== null ||
    tags.domains.length > 0 ||
    tags.business !== null ||
    tags.connects.length > 0
  );
}

/**
 * ファイル先頭の JSDoc コメントから graph-* tag を抽出する (self-management 流の
 * file-level inheritance 用、cortex には無い独自処理)。
 *
 * @graph-connects none
 */
export function extractFileTags(source: string): ParsedGraphTags {
  const tags: ParsedGraphTags = emptyTags();
  const m = /^\s*\/\*\*([\s\S]*?)\*\//.exec(source);
  if (!m) return tags;
  // JSDoc 内の各行から先頭の `*` (+ space) を剥がし、`@graph-X value` 行を探す
  const lines = m[1].split("\n").map((l) => l.replace(/^\s*\*\s?/, ""));
  for (const line of lines) {
    const lm = /^@(graph-(?:stack|domain|business|connects|node))\s+(.*)$/.exec(line);
    if (lm) applyGraphTag(tags, lm[1], lm[2].trim());
  }
  return tags;
}

/** @graph-connects none */
function emptyTags(): ParsedGraphTags {
  return { nodeType: null, stack: null, domains: [], business: null, connects: [] };
}

/**
 * 宣言の tags に file-level tags をデフォルトとしてマージする (宣言側にあれば優先)。
 *
 * @graph-connects none
 */
export function mergeFileTags(decl: ParsedGraphTags, file: ParsedGraphTags): ParsedGraphTags {
  return {
    nodeType: decl.nodeType ?? file.nodeType,
    stack: decl.stack ?? file.stack,
    domains: decl.domains.length > 0 ? decl.domains : file.domains,
    business: decl.business ?? file.business,
    connects: decl.connects, // connects は宣言側のみ (継承しない)
  };
}

/**
 * 1 つの SourceFile から ParsedExport を全部取り出す (file-level tags を merge)。
 *
 * @graph-connects none
 */
export function extractDeclarationsFromFile(
  sourceFile: SourceFile,
  filePath: string,
  fileTags: ParsedGraphTags = emptyTags(),
): ParsedExport[] {
  const results: ParsedExport[] = [];
  const push = (
    name: string,
    n: { getStartLineNumber: () => number; getEndLineNumber: () => number },
    isExported: boolean,
    tags: ParsedGraphTags,
  ): void => {
    const merged = mergeFileTags(tags, fileTags);
    if (!hasMeaningfulTags(merged)) return;
    results.push({
      name,
      filePath,
      startLine: n.getStartLineNumber(),
      endLine: n.getEndLineNumber(),
      isExported,
      tags: merged,
    });
  };

  for (const fn of sourceFile.getFunctions()) {
    push(fn.getName() ?? "anonymous", fn, fn.isExported(), extractTagsFromNode(fn));
  }
  for (const vs of sourceFile.getVariableStatements()) {
    const tags = extractTagsFromNode(vs);
    for (const decl of vs.getDeclarations()) {
      push(decl.getName(), vs, vs.isExported(), tags);
    }
  }
  for (const cls of sourceFile.getClasses()) {
    push(cls.getName() ?? "anonymous", cls, cls.isExported(), extractTagsFromNode(cls));
    const className = cls.getName() ?? "anonymous";
    for (const method of cls.getMethods()) {
      push(`${className}.${method.getName()}`, method, cls.isExported(), extractTagsFromNode(method));
    }
  }
  for (const iface of sourceFile.getInterfaces()) {
    push(iface.getName(), iface, iface.isExported(), extractTagsFromNode(iface));
  }
  for (const ta of sourceFile.getTypeAliases()) {
    push(ta.getName(), ta, ta.isExported(), extractTagsFromNode(ta));
  }
  for (const en of sourceFile.getEnums()) {
    push(en.getName(), en, en.isExported(), extractTagsFromNode(en));
  }
  for (const ea of sourceFile.getExportAssignments()) {
    if (ea.isExportEquals()) continue;
    push(ea.getExpression().getText(), ea, true, extractTagsFromNode(ea));
  }
  for (const stmt of sourceFile.getStatements()) {
    if (stmt.getKind() !== SyntaxKind.ExpressionStatement) continue;
    const tags = extractTagsFromNode(stmt);
    if (!hasMeaningfulTags(tags)) continue;
    const text = stmt.getText().slice(0, 200);
    const m = /new\s+[\w.]+\(\s*[`'"]([\w-]+)/.exec(text);
    const name = m?.[1] ?? `expr_${stmt.getStartLineNumber()}`;
    push(name, stmt, false, tags);
  }
  return results;
}

/**
 * 指定 glob パターン群から `@graph-*` 含むファイルだけ抽出 (OOM 防止のため)。
 *
 * @graph-connects filesystem [reads_from] glob でファイル一覧 + 中身先読みしてフィルタ
 */
export async function findFilesWithGraphTags(
  patterns: string[],
  cwd: string,
): Promise<string[]> {
  const all: string[] = [];
  for (const p of patterns) {
    const matched = await glob(p, { cwd, absolute: true });
    all.push(...matched);
  }
  const filtered = all.filter((f) => readFileSync(f, "utf-8").includes("@graph-"));
  return [...new Set(filtered)].sort();
}

/**
 * mono-repo 配下の `.ts/.tsx` を chunk ごとに ts-morph に読ませて全 ParsedExport を返す。
 *
 * @graph-connects filesystem [reads_from] @graph-* 含むファイル群を ts-morph で AST 解析
 */
export async function parseJSDocExports(
  cwd: string,
  patterns: string[] = SOURCE_PATTERNS,
  chunkSize = 50,
): Promise<ParsedExport[]> {
  const files = await findFilesWithGraphTags(patterns, cwd);
  const out: ParsedExport[] = [];
  const repoRoot = resolve(cwd);
  for (let i = 0; i < files.length; i += chunkSize) {
    const chunk = files.slice(i, i + chunkSize);
    const project = new Project({ compilerOptions: { allowJs: true } });
    for (const f of chunk) project.addSourceFileAtPath(f);
    for (const sf of project.getSourceFiles()) {
      const rel = sf.getFilePath().startsWith(repoRoot)
        ? sf.getFilePath().slice(repoRoot.length + 1)
        : sf.getFilePath();
      const fileTags = extractFileTags(sf.getFullText());
      out.push(...extractDeclarationsFromFile(sf, rel, fileTags));
    }
  }
  return out;
}
