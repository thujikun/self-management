/**
 * `~/.claude/projects/-Users-ryan-Workspace-x/memory/*.md` parser。
 *
 * 各 file は YAML frontmatter (name / description / type) + 本文。
 * frontmatter の `type` で振り分け:
 * - "user"      → user_role / user_philosophy 系。decisions として登録 (Ryan の自己定義)
 * - "feedback"  → feedback_x_* 系。decisions として登録 (運用方針)
 * - "project"   → cortex_design 系。topics として登録 (思想テーマ)
 * - "reference" → x_account_strategy など。skip (本体が strategy doc 側で登録済)
 *
 * external_id = file basename (拡張子なし)、source = "memory"
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business memory ファイル群を decisions / topics ノードに振り分ける parser。Claude memory に蓄積された運用方針・哲学・テーマを graph に取り込む入口
 * @graph-connects memory-files [reads_from] ~/.claude/projects/-Users-ryan-Workspace-x/memory/*.md を読み取り decisions / topics に展開
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { deterministicId } from "../common/id.js";
import { SELF_PERSON_ID } from "./threads.js";
import type { EdgeInput, NodeInput, ParseResult } from "../common/types.js";

/** @graph-connects none */
const SOURCE = "memory";

/** @graph-connects none */
const DEFAULT_DIR = join(
  homedir(),
  ".claude/projects/-Users-ryan-Workspace-x/memory",
);

interface MemoryFrontmatter {
  name?: string;
  description?: string;
  type?: "user" | "feedback" | "project" | "reference";
}

/** @graph-connects none */
function parseFrontmatter(md: string): { fm: MemoryFrontmatter; body: string } {
  if (!md.startsWith("---\n")) return { fm: {}, body: md };
  const end = md.indexOf("\n---\n", 4);
  if (end < 0) return { fm: {}, body: md };
  const raw = md.slice(4, end);
  const body = md.slice(end + 5).trim();

  const fm: MemoryFrontmatter = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1] as keyof MemoryFrontmatter;
    const val = m[2].replace(/^["']|["']$/g, "");
    (fm as Record<string, string>)[key] = val;
  }
  return { fm, body };
}

/**
 * memory ディレクトリを読んで decisions / topics に振り分ける parser entry。
 *
 * @graph-connects memory-files [reads_from] ~/.claude memory dir
 */
export async function parseMemory(dir: string = DEFAULT_DIR): Promise<ParseResult> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md") && f !== "MEMORY.md");
  const nodes: NodeInput[] = [];
  const edges: EdgeInput[] = [];

  for (const file of files) {
    const path = join(dir, file);
    const raw = await readFile(path, "utf8");
    const { fm, body } = parseFrontmatter(raw);
    const externalId = basename(file, ".md");

    if (fm.type === "reference") continue;

    const fileStat = await stat(path);
    const seenAt = fileStat.mtime.toISOString();

    if (fm.type === "user" || fm.type === "feedback") {
      // decision として登録
      const id = deterministicId(SOURCE, externalId);
      nodes.push({
        kind: "decisions",
        id,
        fields: {
          decision_id: id,
          title: fm.name ?? externalId,
          rationale_md: body,
          decided_at: seenAt,
          scope: { kind: fm.type, file: externalId },
        },
        metadata: {
          source: SOURCE,
          source_file: `memory/${file}`,
          memory_type: fm.type,
          external_id: externalId,
          description: fm.description ?? null,
          language: "en",
        },
      });
      edges.push({
        edge_table: "personal_edges",
        edge_type: "authored",
        src_kind: "persons",
        src_id: SELF_PERSON_ID,
        tgt_kind: "decisions",
        tgt_id: id,
        created_at: seenAt,
      });
    } else if (fm.type === "project") {
      // topic として登録 (思想テーマ)
      const id = deterministicId(SOURCE, externalId);
      nodes.push({
        kind: "topics",
        id,
        fields: {
          topic_id: id,
          name: fm.name ?? externalId,
          description: fm.description ?? null,
        },
        metadata: {
          source: SOURCE,
          source_file: `memory/${file}`,
          memory_type: fm.type,
          external_id: externalId,
          body_md: body,
          language: "en",
        },
      });
    } else {
      // type unknown: skip
      console.warn(`memory: skip ${file} (unknown type=${fm.type ?? "missing"})`);
    }
  }

  return { source: SOURCE, nodes, edges };
}
