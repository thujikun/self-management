#!/usr/bin/env tsx
/**
 * `@graph-*` JSDoc タグ整合性 guard の pure library。
 *
 * cortex の `@cortex/eslint-plugin-graph` (require-graph-business / require-graph-connects /
 * valid-graph-stack 等) を、self-management の規模に合わせて軽量な単一スクリプトで再実装。
 *
 * 検証項目:
 * 1. 対象ファイル (apps/, packages/, infra/ 配下の .ts/.tsx) には **ファイル先頭 JSDoc** に
 *    `@graph-stack` / `@graph-domain` / `@graph-business` / `@graph-connects` が必須
 * 2. 対象ファイル内の **トップレベル宣言** (export / const / function / class) に
 *    `@graph-connects` が必須 (なければ `none` 明示)
 * 3. `@graph-stack` の値は `STACKS` 一覧に登録済みでなければならない
 * 4. `@graph-domain` の値は `DOMAINS` 一覧に登録済みでなければならない
 *
 * CLI は `check-graph-tags.cli.ts` 経由。本ファイルは pure helper のみで副作用なし。
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business cortex の eslint-plugin-graph を軽量再実装した pre-commit guard の純粋ライブラリ部。@graph-stack/@graph-domain/@graph-business をファイル先頭、@graph-connects を全トップレベル宣言に強制し、stack/domain 値の一覧との整合も検証する
 * @graph-connects none
 */

import { readFileSync, existsSync } from "node:fs";

/**
 * 既知 stack 一覧。新規 stack を追加する場合はここに足す。
 *
 * @graph-connects none
 */
export const STACKS = new Set(["core", "ryan-product-graph", "ryantsuji-dev"]);

/**
 * 既知 domain 一覧。新規 domain を追加する場合はここに足す。
 *
 * @graph-connects none
 */
export const DOMAINS = new Set(["infra", "graph", "x-runtime", "content-pipeline", "release-management", "publishing"]);

/**
 * 対象拡張子。.test.ts は除外。bin/ は CLI entry point として src/ 側のテスト済 lib を
 * thin wrap するだけなので tag 強制対象外 (cortex の `apps/cli/*` 例外と同精神)。
 *
 * @graph-connects none
 */
export const TARGET_RE = /^(apps|packages|infra)\/.+\.tsx?$/;

/** @graph-connects none */
export const EXCLUDE_RE = /(\.(test|spec|d)\.tsx?$|\/bin\/)/;

export interface FileError {
  file: string;
  msg: string;
}

/**
 * ファイル先頭 JSDoc から graph タグを抽出。
 *
 * ファイル先頭の `/** ... *\/` ブロックを 1 つだけ取り出し、
 * `@graph-stack` 等の出現を辞書として返す。
 *
 * @graph-connects none
 */
export function extractFileJsdoc(src: string): Record<string, string> | null {
  const m = src.match(/^\s*\/\*\*([\s\S]*?)\*\//);
  if (!m) return null;
  const block = m[1];
  const tags: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const t = line.match(/@(graph-[a-z-]+)\s+(.+?)\s*$/);
    if (t) tags[t[1]] = t[2].trim();
  }
  return tags;
}

/**
 * ファイル先頭 JSDoc を必須タグ存在チェック。
 *
 * @graph-connects none
 */
export function checkFileLevelTags(file: string, src: string, errors: FileError[]): void {
  const tags = extractFileJsdoc(src);
  if (!tags) {
    errors.push({ file, msg: "missing file-level JSDoc with @graph-* tags" });
    return;
  }
  for (const required of ["graph-stack", "graph-domain", "graph-business", "graph-connects"]) {
    if (!tags[required]) {
      errors.push({ file, msg: `file JSDoc missing @${required}` });
    }
  }
  if (tags["graph-stack"] && !STACKS.has(tags["graph-stack"])) {
    errors.push({
      file,
      msg: `unknown @graph-stack: "${tags["graph-stack"]}". 既知: ${[...STACKS].join(", ")}`,
    });
  }
  if (tags["graph-domain"] && !DOMAINS.has(tags["graph-domain"])) {
    errors.push({
      file,
      msg: `unknown @graph-domain: "${tags["graph-domain"]}". 既知: ${[...DOMAINS].join(", ")}`,
    });
  }
}

/**
 * トップレベル宣言が `@graph-connects` を持っているか検証する。
 *
 * 完全な AST parser ではなく、行頭ベースの heuristic:
 * - `^export ` / `^const ` / `^let ` / `^var ` / `^function ` / `^class ` / `^async function `
 *   が現れる行を「宣言」とみなし、
 * - その直前の連続する `/** ... *\/` または `// ...` ブロックに `@graph-connects` が
 *   含まれているかを見る
 *
 * 完全性より「網羅的すぎないけど抜けは出にくい」を優先。
 *
 * @graph-connects none
 */
export function checkDeclarationConnects(file: string, src: string, errors: FileError[]): void {
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (!/^(export\s+(const|let|var|function|async\s+function|class|interface|type|enum|default\s+function)|const|let|var|function|async\s+function|class)\s/.test(ln)) {
      continue;
    }
    // type / interface / enum は @graph-connects 不要 (cortex の `requireForTypes` デフォルト false)
    if (/^export\s+(type|interface|enum)\s/.test(ln) || /^(type|interface|enum)\s/.test(ln)) continue;

    // 直前に block JSDoc または line-comment が続くか確認
    let j = i - 1;
    let hasGraphConnects = false;
    let foundComment = false;

    // Skip blank lines once
    while (j >= 0 && lines[j].trim() === "") j--;

    // block JSDoc ` * / の行から逆に登る
    if (j >= 0 && lines[j].trim().endsWith("*/")) {
      foundComment = true;
      while (j >= 0) {
        if (lines[j].includes("@graph-connects")) hasGraphConnects = true;
        if (lines[j].trim().startsWith("/*") || lines[j].trim().startsWith("/**")) break;
        j--;
      }
    } else if (j >= 0 && lines[j].trim().startsWith("//")) {
      // 行コメントの連続を逆から舐める
      foundComment = true;
      while (j >= 0 && lines[j].trim().startsWith("//")) {
        if (lines[j].includes("@graph-connects")) hasGraphConnects = true;
        j--;
      }
    }

    if (!foundComment || !hasGraphConnects) {
      const declName = ln.match(/(?:const|let|var|function|class|async\s+function)\s+([A-Za-z0-9_$]+)/)?.[1] ?? "(anonymous)";
      errors.push({ file, msg: `top-level "${declName}" missing @graph-connects (line ${i + 1})` });
    }
  }
}

/**
 * 候補ファイルを対象 path フィルタにかけて検証実行。違反 error 配列を返す純粋ロジック。
 *
 * @graph-connects none
 */
export function runGraphTagsCheck(candidates: string[]): FileError[] {
  const targets = candidates.filter(
    (f) => TARGET_RE.test(f) && !EXCLUDE_RE.test(f) && existsSync(f),
  );

  const errors: FileError[] = [];
  for (const file of targets) {
    const src = readFileSync(file, "utf8");
    checkFileLevelTags(file, src, errors);
    checkDeclarationConnects(file, src, errors);
  }
  return errors;
}
