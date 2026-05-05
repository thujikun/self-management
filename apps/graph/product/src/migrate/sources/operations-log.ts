/**
 * `operations/log.md` parser。
 *
 * 各 H2 (`## ...`) section を 1 つの release_note として抽出。
 * H3 (`### ...`) はサブセクション扱い、release_note の body_md にまとめて含める。
 *
 * release_note の released_at は section title の日付から推定:
 * - "## 2026-05-04 23:46 JST - thread posted: dbgraph"
 * - "## 2026-05-01 〜 2026-05-02 (英語アカウントへの reboot)"
 * のような形式から正規表現で抜く。範囲表記は開始日を採用。
 *
 * external_id は "operations-log:<H2 title slug>" でユニーク化。
 * source = "operations-log"。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business operations/log.md を release_notes ノード列に変換する parser。日次の運用ログを時系列 release ノードとして graph に取り込む入口
 * @graph-connects operations-log [reads_from] operations/log.md ファイルを読み取り
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deterministicId } from "../common/id.js";
import type { NodeInput, ParseResult } from "../common/types.js";

/** @graph-connects none */
const SOURCE = "operations-log";

/** @graph-connects none */
const REPO_ROOT = fileURLToPath(new URL("../../../../../../", import.meta.url));
/** @graph-connects none */
const DEFAULT_PATH = join(REPO_ROOT, "operations/log.md");

interface Section {
  title: string;
  body: string;
  released_at: string; // ISO 8601 (date-only OK; BQ TIMESTAMP は midnight UTC で扱う)
}

/**
 * H2 タイトル先頭の日付を ISO 8601 に正規化。
 * - "2026-05-04 23:46 JST - thread posted: dbgraph"  → "2026-05-04T14:46:00Z"
 * - "2026-05-04 23:50 JST - daily action: ..."        → "2026-05-04T14:50:00Z"
 * - "2026-05-01 〜 2026-05-02 (...)"                  → "2026-05-01T00:00:00Z"
 * - "学び (...)"  日付なし                            → null (release_note ではないので skip)
 *
 * @graph-connects none
 */
function parseDateFromTitle(title: string): string | null {
  // YYYY-MM-DD HH:MM JST
  const dt = title.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})\s+JST/);
  if (dt) {
    const [, y, mo, d, h, mi] = dt;
    // JST = UTC+9
    const utcH = (parseInt(h, 10) - 9 + 24) % 24;
    const dayShift = parseInt(h, 10) - 9 < 0 ? -1 : 0;
    const dayN = parseInt(d, 10) + dayShift;
    const dayStr = String(dayN).padStart(2, "0");
    return `${y}-${mo}-${dayStr}T${String(utcH).padStart(2, "0")}:${mi}:00Z`;
  }
  // YYYY-MM-DD (date only or with 〜 range)
  const d = title.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (d) {
    return `${d[1]}-${d[2]}-${d[3]}T00:00:00Z`;
  }
  return null;
}

/** @graph-connects none */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

/**
 * markdown を H2 でセクション分割。各セクションは title + body 全文 (H3 含む)。
 * "---" hr は section 区切りに数えない (内部装飾)。
 *
 * @graph-connects none
 */
function splitH2Sections(md: string): Array<{ title: string; body: string }> {
  const lines = md.split("\n");
  const sections: Array<{ title: string; body: string }> = [];
  let current: { title: string; body: string[] } | null = null;
  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m && !line.startsWith("###")) {
      if (current) sections.push({ title: current.title, body: current.body.join("\n").trim() });
      current = { title: m[1].trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) sections.push({ title: current.title, body: current.body.join("\n").trim() });
  return sections;
}

/**
 * operations/log.md を読んで release_note ノード配列に変換する parser entry。
 *
 * @graph-connects operations-log [reads_from] operations/log.md を読み込み release_notes に変換
 */
export async function parseOperationsLog(path: string = DEFAULT_PATH): Promise<ParseResult> {
  const md = await readFile(path, "utf8");
  const sections = splitH2Sections(md);
  const nodes: NodeInput[] = [];

  for (const sec of sections) {
    const released_at = parseDateFromTitle(sec.title);
    if (!released_at) continue; // 日付なし section (例: "学び") は release_note として登録しない
    const slug = slugify(sec.title);
    const externalId = `${released_at.slice(0, 10)}:${slug}`;
    const id = deterministicId(SOURCE, externalId);
    nodes.push({
      kind: "release_notes",
      id,
      fields: {
        release_note_id: id,
        title: sec.title,
        body_md: sec.body,
        released_at,
        version: null,
      },
      metadata: {
        source: SOURCE,
        source_file: "operations/log.md",
        external_id: externalId,
        language: "ja",
      },
    });
  }

  return { source: SOURCE, nodes, edges: [] };
}
