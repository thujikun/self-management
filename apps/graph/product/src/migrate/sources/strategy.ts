/**
 * `x-account-strategy.md` parser。
 *
 * 戦略 doc 全体 = 1 つの decision node (kind=decisions)。
 * 各 H2 section は分割せず body_md にまとめる (戦略は一体として読まれる文書)。
 *
 * external_id = "x-account-strategy"
 * source = "strategy-doc"
 *
 * topic 抽出は P2 では行わない (memory 側でやる方が密度高い)。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business 戦略 doc 1 ファイルを 1 つの decision ノードに変換し、Ryan 本人との authored edge を張る parser。長期的判断を graph 上に乗せる入口
 * @graph-connects strategy-doc [reads_from] x-account-strategy.md を読み取り decisions に変換
 */

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deterministicId } from "../common/id.js";
import { SELF_PERSON_ID } from "./threads.js";
import type { EdgeInput, NodeInput, ParseResult } from "../common/types.js";

/** @graph-connects none */
const SOURCE = "strategy-doc";
/** @graph-connects none */
const REPO_ROOT = fileURLToPath(new URL("../../../../../../", import.meta.url));
/** @graph-connects none */
const DEFAULT_PATH = join(REPO_ROOT, "x-account-strategy.md");

/**
 * x-account-strategy.md を読んで decision + authored edge を返す parser entry。
 *
 * @graph-connects strategy-doc [reads_from] x-account-strategy.md を読み込み
 */
export async function parseStrategyDoc(path: string = DEFAULT_PATH): Promise<ParseResult> {
  const md = await readFile(path, "utf8");
  const fileStat = await stat(path);
  const decidedAt = fileStat.birthtime.toISOString();

  // 最初の H1 をタイトルに使う
  const titleMatch = md.match(/^#\s+(.+?)\s*$/m);
  const title = titleMatch ? titleMatch[1].trim() : "X account strategy";

  const externalId = "x-account-strategy";
  const id = deterministicId(SOURCE, externalId);

  const nodes: NodeInput[] = [
    {
      kind: "decisions",
      id,
      fields: {
        decision_id: id,
        title,
        rationale_md: md,
        decided_at: decidedAt,
        scope: { domain: "x-account", role: "strategy" },
      },
      metadata: {
        source: SOURCE,
        source_file: "x-account-strategy.md",
        external_id: externalId,
        language: "ja",
      },
    },
  ];

  const edges: EdgeInput[] = [
    {
      edge_table: "personal_edges",
      edge_type: "authored",
      src_kind: "persons",
      src_id: SELF_PERSON_ID,
      tgt_kind: "decisions",
      tgt_id: id,
      created_at: decidedAt,
    },
  ];

  return { source: SOURCE, nodes, edges };
}
