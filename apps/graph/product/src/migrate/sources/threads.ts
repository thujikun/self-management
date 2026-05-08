/**
 * `threads/posted/*.md` parser。
 *
 * 各 file = 1 つの X thread = 1 つの content node (kind=contents, source=x)。
 * 個別 tweet は metadata.tweet_chain に展開して保持 (separate node にはしない)。
 *
 * external_id = conversation_id (root tweet ID)。
 * URL = `https://x.com/ryantsuji/status/<conversation_id>`。
 *
 * 副作用:
 * - Ryan 本人の person node を seed (handle "ryantsuji") して authored edge を張る
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business 投稿済み X thread の markdown ファイルを contents ノードに変換し、authored edge で Ryan 本人 (persons.ryantsuji) と接続する parser。X 由来コンテンツの取り込み入口
 * @graph-connects threads-posted [reads_from] threads/posted/*.md を読み取り contents + persons + authored edges に展開
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deterministicId } from "../common/id.js";
import type { EdgeInput, NodeInput, ParseResult } from "../common/types.js";

/** @graph-connects none */
const SOURCE = "thread";
/** @graph-connects none */
const PERSON_SOURCE = "person";

/** @graph-connects none */
const REPO_ROOT = fileURLToPath(new URL("../../../../../../", import.meta.url));
/** @graph-connects none */
const DEFAULT_DIR = join(REPO_ROOT, "threads/posted");

/** @graph-connects none */
const RYAN_PERSON_ID = deterministicId(PERSON_SOURCE, "ryantsuji");

/**
 * 各 thread の手書き要約 (embedding の input)。
 * key は thread_posted file の `thread_name` か `short_name` のいずれか。
 *
 * @graph-connects none
 */
const THREAD_SUMMARIES: Record<string, string> = {
  "17mcp":
    '17 MCP Servers thread (5本、2026-05-03 JST 20:00 投稿)。airCloset の Agentic Graph RAG を支えている 17 個の MCP server fleet を CTO 1 人で運用するために必要だった boring infra (共通 OAuth library、Redis sessions、shared BigQuery logger) の実装と、なぜ stateful monolith ではなく fleet にしたのかという設計判断の話。1.4M ユーザー基盤を持つ会社で AI infra を CTO 1 人が builds する事例として、英語圏 AI infra コミュニティ向けの再 boot 1 本目。',
  dbgraph:
    "DB Graph thread (5本、2026-05-04 JST 23:14 投稿)。airCloset の 991 BQ tables / 15 schemas を natural language で誰でも query できる MCP server を $10/月 で構築した話。dictionary materialization が hard part、knowledge と access を分離する設計、Gemini で全 991 表 description を first-pass 生成し human review で long-tail を埋める運用、GCP OIDC → AWS STS → VPC Lambda の zero-static-creds auth chain、variant 検出で daily rebuild $0.10-0.20。dev.to 元記事へのリンクで thread を締める構成。",
};

export interface Frontmatter {
  thread_name?: string;
  short_name?: string;
  conversation_id?: string;
  posted_at?: string;
  posted_at_utc?: string;
  source?: string;
  source_article?: string;
  tweet_ids?: Array<Record<string, string>>;
  // parser は YAML 値を全部 string で扱うため、chain item も Record<string, string>。
  // tweet → number 変換は extractTweetChain 側で実施。
  chain?: Array<Record<string, string>>;
  verified?: boolean;
}

/**
 * 雑な YAML frontmatter parser (`---`...`---` で囲まれた key:value 行と簡単な list を扱う)。
 * 完全な YAML は不要、自分の thread_posted ファイルが扱う構造のみサポート。
 *
 * @graph-connects none
 */
export function parseFrontmatter(md: string): { fm: Frontmatter; body: string } {
  if (!md.startsWith("---\n")) return { fm: {}, body: md };
  const end = md.indexOf("\n---\n", 4);
  if (end < 0) return { fm: {}, body: md };
  const raw = md.slice(4, end);
  const body = md.slice(end + 5);

  const fm: Record<string, unknown> = {};
  const lines = raw.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.startsWith("#")) {
      i++;
      continue;
    }
    const m = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!m) {
      i++;
      continue;
    }
    const [, key, rest] = m;
    if (rest.length > 0) {
      // scalar
      fm[key] = rest.replace(/^["']|["']$/g, "");
      i++;
    } else {
      // collection (list of dicts or list of mappings)
      const items: Array<Record<string, string>> = [];
      i++;
      while (i < lines.length && (lines[i].startsWith("  -") || lines[i].startsWith("    "))) {
        if (lines[i].startsWith("  -")) {
          // 新 item start
          const itemHead = lines[i].slice(3).trim();
          const item: Record<string, string> = {};
          if (itemHead) {
            // 単行式: `  - key: value`。key は quoted numeric (例: "1") も許容。
            const sub = itemHead.match(/^["']?([\w]+)["']?:\s*(.+)$/);
            if (sub) item[sub[1]] = sub[2].replace(/^["']|["']$/g, "");
          }
          i++;
          while (i < lines.length && lines[i].startsWith("    ") && !lines[i].startsWith("  -")) {
            const sub = lines[i].trim().match(/^["']?([\w]+)["']?:\s*(.+)$/);
            if (sub) item[sub[1]] = sub[2].replace(/^["']|["']$/g, "");
            i++;
          }
          items.push(item);
        } else {
          i++;
        }
      }
      fm[key] = items;
    }
  }
  return { fm: fm as Frontmatter, body: body.trim() };
}

/**
 * frontmatter から conversation_id と tweet chain を取り出して metadata 用に正規化。
 *
 * @graph-connects none
 */
export function extractTweetChain(fm: Frontmatter): { conversationId: string | null; chain: Array<{ tweet: number; id: string }> } {
  if (fm.chain && Array.isArray(fm.chain)) {
    return {
      conversationId: fm.conversation_id ?? null,
      chain: fm.chain.map((c) => ({ tweet: Number(c.tweet), id: String(c.id) })),
    };
  }
  if (fm.tweet_ids && Array.isArray(fm.tweet_ids)) {
    const chain: Array<{ tweet: number; id: string }> = [];
    for (const item of fm.tweet_ids) {
      // item の shape: {"1": "<id>"} など、key が連番
      for (const [k, v] of Object.entries(item)) {
        const n = Number(k);
        if (!Number.isNaN(n)) chain.push({ tweet: n, id: String(v) });
      }
    }
    chain.sort((a, b) => a.tweet - b.tweet);
    return { conversationId: fm.conversation_id ?? chain[0]?.id ?? null, chain };
  }
  return { conversationId: fm.conversation_id ?? null, chain: [] };
}

/**
 * threads/posted/*.md を読んで contents + persons + authored edges に変換する parser entry。
 *
 * @graph-connects threads-posted [reads_from] threads/posted/*.md を読み取り
 */
export async function parseThreads(dir: string = DEFAULT_DIR): Promise<ParseResult> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
  const nodes: NodeInput[] = [];
  const edges: EdgeInput[] = [];

  // Ryan 本人 (self) を必ず先頭に登録。body_summary は self profile の凝縮。
  const ryanSummary =
    "Ryan Tsuji (@ryantsuji on X、@thujikun on GitHub/Zenn)。airCloset (1.4M users、日本最大のファッションレンタル) の CTO。Claude Code / MCP のヘビーユーザーで、production AI infrastructure を 1 人で構築・運用してきた立場。社内 codebase + DBs の上に Agentic Graph RAG を実装し、17 MCP servers の fleet を運用、991 BQ tables を natural language で query できる DB Graph MCP を $10/月で動かしている。日本市場では Zenn ベースの認知があり、英語圏では再 boot 中で sub-200 follower phase。Why over How / 知識の外部化 / AI as leverage on non-AI business を一貫して主張する。";

  nodes.push({
    kind: "persons",
    id: RYAN_PERSON_ID,
    fields: {
      person_id: RYAN_PERSON_ID,
      primary_handle: "ryantsuji",
      identifiers: [
        { platform: "x", value: "ryantsuji" },
        { platform: "x_id", value: "183196464" },
        { platform: "github", value: "thujikun" },
        { platform: "zenn", value: "thujikun" },
      ],
      display_name: "Ryan Tsuji",
      bio: "CTO @airCloset (1.4M users). Built an Agentic Graph RAG over our codebase + DBs. Writing about AI infra that actually works in production. Tokyo 🇯🇵",
      metadata: { language: "ja+en", role: "self" },
    },
    body_summary: ryanSummary,
    metadata: { language: "ja+en", role: "self" },
  });

  for (const file of files) {
    const path = join(dir, file);
    const raw = await readFile(path, "utf8");
    const { fm, body } = parseFrontmatter(raw);
    const { conversationId, chain } = extractTweetChain(fm);
    if (!conversationId) {
      console.warn(`threads: skip ${file} (no conversation_id)`);
      continue;
    }

    const id = deterministicId("x", conversationId);
    const url = `https://x.com/ryantsuji/status/${conversationId}`;
    const publishedAt = fm.posted_at_utc
      ? fm.posted_at_utc
      : fm.posted_at
        ? new Date(fm.posted_at).toISOString()
        : null;

    // 個別 thread は手書き summary (THREAD_SUMMARIES) があれば使い、無ければ body 先頭抜粋に fallback。
    const shortName = fm.thread_name ?? fm.short_name ?? file.replace(/\.md$/, "");
    const summary =
      THREAD_SUMMARIES[shortName] ??
      THREAD_SUMMARIES[fm.short_name ?? ""] ??
      THREAD_SUMMARIES[fm.thread_name ?? ""] ??
      body.replace(/```[\s\S]*?```/g, "").slice(0, 500).trim();

    nodes.push({
      kind: "contents",
      id,
      fields: {
        content_id: id,
        source: "x",
        external_id: conversationId,
        url,
        title: shortName,
        body_md: body,
        published_at: publishedAt,
        author_person_id: RYAN_PERSON_ID,
      },
      body_summary: summary,
      metadata: {
        source: SOURCE,
        source_file: `threads/posted/${file}`,
        subtype: "thread",
        conversation_id: conversationId,
        tweet_chain: chain,
        source_article_url: fm.source_article ?? null,
        verified: fm.verified ?? null,
        language: "en",
      },
    });

    // authored edge: Ryan → thread
    edges.push({
      edge_table: "personal_edges",
      edge_type: "authored",
      src_kind: "persons",
      src_id: RYAN_PERSON_ID,
      tgt_kind: "contents",
      tgt_id: id,
      created_at: publishedAt ?? undefined,
    });
  }

  return { source: SOURCE, nodes, edges };
}

/**
 * 他 parser から Ryan 本人 person_id を参照するためのエクスポート。
 *
 * @graph-connects none
 */
export const SELF_PERSON_ID = RYAN_PERSON_ID;
