/**
 * personal-graph schema。
 *
 * Ryan の人格・content・思想・関係性 (X follow / reply / quote / DM 含む)。
 * node table は type ごとに分離 (cortex の 1-table-with-discriminator とは異なる選択、
 * type-specific column を REQUIRED にして schema 自己文書化)。
 * edges は polymorphic な 1 table、cross-graph (product / release) の参照も含めて全部ここに。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business Ryan 自身の人格・コンテンツ・思想・社会関係 (X follow / reply / DM 含む) を統合する schema。type ごと別テーブルで型固有カラムを REQUIRED にし、edges は polymorphic で cross-graph 参照も収容
 * @graph-connects bigquery [writes_to] persons / contents / decisions / topics / events / personal_edges 6 テーブルを定義
 */

import type { TableSchema } from "@google-cloud/bigquery";
import {
  COMMON_EMBEDDING_FIELDS,
  COMMON_TIMESTAMP_FIELDS,
  type BaseRowFields,
  type NodeTable,
  type TableDefinition,
} from "../shared.js";

/**
 * `contents` の source platform 値。新 platform 追加時はここに足す。
 *
 * @graph-connects none
 */
export const CONTENT_SOURCES = [
  "x", // X (Twitter) tweet または DM (metadata.subtype で区別)
  "zenn",
  "devto",
  "youtube",
  "podcast",
  "speakerdeck",
  "interview",
  "internal",
  "manual",
] as const;

export type ContentSource = (typeof CONTENT_SOURCES)[number];

/**
 * `personal_edges` の edge 種別。
 * cross-graph (release / product への参照) も含む。
 *
 * @graph-connects none
 */
export const PERSONAL_EDGE_TYPES = [
  // authorship
  "authored", // person → content / decision

  // content relations (X reply / quote / 引用)
  "replied_to", // content → content
  "quoted", // content → content
  "references", // content → any (cross-graph 含む)
  "same_entity", // content → content (翻訳ペア等、言語違いの同一記事)

  // social (X follow / engagement)
  "follows", // person → person
  "engaged_with", // person → content (like / view / DM 反応)

  // categorization
  "tagged", // topic → content / decision

  // decisions / events
  "decision_about", // decision → any (cross-graph 含む)
  "mentioned_in", // person → content (登壇 / 記事内の言及)
  "participated_in", // person → event

  // temporal anchoring (biz-graph と同思想)
  "occurred_on", // any activity → time_buckets (granularity=day)
  "rolls_up_to", // time_buckets → time_buckets (day → week → month)
] as const;

export type PersonalEdgeType = (typeof PERSONAL_EDGE_TYPES)[number];

/** @graph-connects none */
export const PERSONS_TABLE = "persons";
/** @graph-connects none */
export const CONTENTS_TABLE = "contents";
/** @graph-connects none */
export const DECISIONS_TABLE = "decisions";
/** @graph-connects none */
export const TOPICS_TABLE = "topics";
/** @graph-connects none */
export const EVENTS_TABLE = "events";
/** @graph-connects none */
export const TIME_BUCKETS_TABLE = "time_buckets";
/** @graph-connects none */
export const ENGAGEMENT_DECISIONS_TABLE = "engagement_decisions";
/** @graph-connects none */
export const LEARNINGS_TABLE = "learnings";
/** @graph-connects none */
export const PERSONAL_EDGES_TABLE = "personal_edges";

/**
 * `time_buckets.granularity` の許容値。
 *
 * @graph-connects none
 */
export const TIME_BUCKET_GRANULARITIES = ["day", "week", "month"] as const;
export type TimeBucketGranularity = (typeof TIME_BUCKET_GRANULARITIES)[number];

/**
 * `engagement_decisions.action_type` の許容値。
 *
 * @graph-connects none
 */
export const ENGAGEMENT_ACTION_TYPES = [
  "posted", // 我々が post / reply / quote した
  "dropped", // draft したが投稿しなかった
  "follow", // フォローした
  "unfollow",
  "like",
  "skip", // 検討して反応しないと判断した
] as const;
export type EngagementActionType = (typeof ENGAGEMENT_ACTION_TYPES)[number];

/** @graph-connects none */
const PERSONS_SCHEMA: TableSchema = {
  fields: [
    { name: "person_id", type: "STRING", mode: "REQUIRED" },
    { name: "primary_handle", type: "STRING", mode: "NULLABLE" }, // 普段 Ryan が呼ぶときの handle (e.g. "ryantsuji")
    { name: "identifiers", type: "JSON", mode: "NULLABLE" }, // [{platform: "x", value: "ryantsuji"}, ...]
    { name: "display_name", type: "STRING", mode: "NULLABLE" },
    { name: "bio", type: "STRING", mode: "NULLABLE" },
    { name: "metadata", type: "JSON", mode: "NULLABLE" }, // X-specific (followers_count, listed_count, ...)
    ...COMMON_EMBEDDING_FIELDS,
    ...COMMON_TIMESTAMP_FIELDS,
  ],
};

/** @graph-connects none */
const CONTENTS_SCHEMA: TableSchema = {
  fields: [
    { name: "content_id", type: "STRING", mode: "REQUIRED" },
    { name: "source", type: "STRING", mode: "REQUIRED" }, // x | zenn | devto | ...
    { name: "external_id", type: "STRING", mode: "NULLABLE" }, // platform native ID (tweet_id 等)
    { name: "url", type: "STRING", mode: "NULLABLE" },
    { name: "title", type: "STRING", mode: "NULLABLE" },
    { name: "body_md", type: "STRING", mode: "NULLABLE" },
    { name: "body_summary", type: "STRING", mode: "NULLABLE" },
    { name: "published_at", type: "TIMESTAMP", mode: "NULLABLE" },
    { name: "author_person_id", type: "STRING", mode: "NULLABLE" },
    { name: "metadata", type: "JSON", mode: "NULLABLE" }, // X: subtype (tweet/dm/retweet), conversation_id, recipient_person_ids, private 等
    ...COMMON_EMBEDDING_FIELDS,
    ...COMMON_TIMESTAMP_FIELDS,
  ],
};

/** @graph-connects none */
const DECISIONS_SCHEMA: TableSchema = {
  fields: [
    { name: "decision_id", type: "STRING", mode: "REQUIRED" },
    { name: "title", type: "STRING", mode: "REQUIRED" },
    { name: "rationale_md", type: "STRING", mode: "NULLABLE" },
    { name: "decided_at", type: "TIMESTAMP", mode: "REQUIRED" },
    { name: "scope", type: "JSON", mode: "NULLABLE" },
    { name: "metadata", type: "JSON", mode: "NULLABLE" },
    ...COMMON_EMBEDDING_FIELDS,
    ...COMMON_TIMESTAMP_FIELDS,
  ],
};

/** @graph-connects none */
const TOPICS_SCHEMA: TableSchema = {
  fields: [
    { name: "topic_id", type: "STRING", mode: "REQUIRED" },
    { name: "name", type: "STRING", mode: "REQUIRED" },
    { name: "description", type: "STRING", mode: "NULLABLE" },
    { name: "metadata", type: "JSON", mode: "NULLABLE" },
    ...COMMON_EMBEDDING_FIELDS,
    ...COMMON_TIMESTAMP_FIELDS,
  ],
};

/** @graph-connects none */
const EVENTS_SCHEMA: TableSchema = {
  fields: [
    { name: "event_id", type: "STRING", mode: "REQUIRED" },
    { name: "title", type: "STRING", mode: "REQUIRED" },
    { name: "description", type: "STRING", mode: "NULLABLE" },
    { name: "occurred_at", type: "TIMESTAMP", mode: "REQUIRED" },
    { name: "location", type: "STRING", mode: "NULLABLE" },
    { name: "metadata", type: "JSON", mode: "NULLABLE" },
    ...COMMON_EMBEDDING_FIELDS,
    ...COMMON_TIMESTAMP_FIELDS,
  ],
};

/**
 * 時間軸 anchor。granularity で day / week / month を区別、parent_bucket_id で階層化。
 * 全ての activity (engagement_decisions / decisions / contents の published_at 等) は
 * occurred_on edge で day node に anchor、day → week → month は rolls_up_to で繋ぐ。
 *
 * @graph-connects none
 */
const TIME_BUCKETS_SCHEMA: TableSchema = {
  fields: [
    { name: "bucket_id", type: "STRING", mode: "REQUIRED" }, // "day:YYYY-MM-DD" | "week:YYYY-Www" | "month:YYYY-MM"
    { name: "granularity", type: "STRING", mode: "REQUIRED" },
    { name: "start_date", type: "DATE", mode: "REQUIRED" },
    { name: "end_date", type: "DATE", mode: "REQUIRED" },
    { name: "label", type: "STRING", mode: "NULLABLE" },
    { name: "parent_bucket_id", type: "STRING", mode: "NULLABLE" }, // day → week, week → month, month → null
    { name: "summary", type: "STRING", mode: "NULLABLE" }, // 後追い振り返りで埋める
    { name: "metadata", type: "JSON", mode: "NULLABLE" }, // {action_count, top_topic, ...}
    ...COMMON_EMBEDDING_FIELDS,
    ...COMMON_TIMESTAMP_FIELDS,
  ],
};

/**
 * cross-session に効く insight (失敗例 / 成功例の振り返り)。decisions が「個別判断」を
 * 記録するのに対し、learnings は「将来も再利用可能な原則 / 適用ルール」を捉える。
 *
 * @graph-connects none
 */
const LEARNINGS_SCHEMA: TableSchema = {
  fields: [
    { name: "learning_id", type: "STRING", mode: "REQUIRED" },
    { name: "insight", type: "STRING", mode: "REQUIRED" }, // 短い洞察文
    { name: "context", type: "STRING", mode: "NULLABLE" }, // 何があって学んだか
    { name: "domain", type: "STRING", mode: "NULLABLE" }, // x-engagement | infra | tooling | ...
    { name: "applicability", type: "STRING", mode: "NULLABLE" }, // 何に適用すべきか
    { name: "realized_at", type: "TIMESTAMP", mode: "REQUIRED" },
    { name: "metadata", type: "JSON", mode: "NULLABLE" },
    ...COMMON_EMBEDDING_FIELDS,
    ...COMMON_TIMESTAMP_FIELDS,
  ],
};

/**
 * Engagement 判断ログ。X / 他 platform で post / drop / follow / like / skip した記録。
 * voice check / draft iteration / rationale を構造化保持して semantic search 可能にする。
 *
 * @graph-connects none
 */
const ENGAGEMENT_DECISIONS_SCHEMA: TableSchema = {
  fields: [
    { name: "engagement_id", type: "STRING", mode: "REQUIRED" },
    { name: "platform", type: "STRING", mode: "REQUIRED" }, // "x" | "linkedin" | "hn" | ...
    { name: "account", type: "STRING", mode: "NULLABLE" }, // "ryantsuji" | "ryanaircloset"
    { name: "action_type", type: "STRING", mode: "REQUIRED" }, // posted / dropped / follow / unfollow / like / skip
    { name: "posted_post_id", type: "STRING", mode: "NULLABLE" }, // 我々の post id (action_type=posted のみ)
    { name: "posted_post_type", type: "STRING", mode: "NULLABLE" }, // original | reply | quote | thread
    { name: "target_post_id", type: "STRING", mode: "NULLABLE" },
    { name: "target_user_id", type: "STRING", mode: "NULLABLE" },
    { name: "target_handle", type: "STRING", mode: "NULLABLE" },
    { name: "target_followers", type: "INT64", mode: "NULLABLE" },
    { name: "our_text", type: "STRING", mode: "NULLABLE" }, // posted/dropped の draft / 本文
    { name: "voice_check", type: "JSON", mode: "NULLABLE" }, // {em_dash, isnt_x_its_y, praise, self_promo, ...}
    { name: "draft_iters", type: "INT64", mode: "NULLABLE" },
    { name: "strategy_tier", type: "STRING", mode: "NULLABLE" }, // tier_1 | tier_2 | tier_3 | reciprocation
    { name: "rationale", type: "STRING", mode: "NULLABLE" },
    { name: "decided_at", type: "TIMESTAMP", mode: "REQUIRED" },
    { name: "conversation_id", type: "STRING", mode: "NULLABLE" },
    { name: "metadata", type: "JSON", mode: "NULLABLE" },
    ...COMMON_EMBEDDING_FIELDS,
    ...COMMON_TIMESTAMP_FIELDS,
  ],
};

/** @graph-connects none */
const PERSONAL_EDGES_SCHEMA: TableSchema = {
  fields: [
    { name: "edge_id", type: "STRING", mode: "REQUIRED" },
    { name: "edge_type", type: "STRING", mode: "REQUIRED" },
    { name: "src_kind", type: "STRING", mode: "REQUIRED" },
    { name: "src_id", type: "STRING", mode: "REQUIRED" },
    { name: "tgt_kind", type: "STRING", mode: "REQUIRED" },
    { name: "tgt_id", type: "STRING", mode: "REQUIRED" },
    { name: "weight", type: "FLOAT64", mode: "NULLABLE" },
    { name: "properties", type: "JSON", mode: "NULLABLE" }, // first_observed_at / last_observed_at / source 等
    { name: "created_at", type: "TIMESTAMP", mode: "REQUIRED" },
  ],
};

/**
 * personal-graph に属する全 table 定義。`init-bq` / `migrate` から消費。
 *
 * @graph-connects none
 */
export const PERSONAL_GRAPH_TABLES: TableDefinition[] = [
  {
    name: PERSONS_TABLE,
    options: {
      schema: PERSONS_SCHEMA,
      timePartitioning: { type: "DAY", field: "first_seen_at" },
    },
  },
  {
    name: CONTENTS_TABLE,
    options: {
      schema: CONTENTS_SCHEMA,
      timePartitioning: { type: "DAY", field: "first_seen_at" },
      clustering: { fields: ["source", "author_person_id"] },
    },
  },
  {
    name: DECISIONS_TABLE,
    options: {
      schema: DECISIONS_SCHEMA,
      timePartitioning: { type: "DAY", field: "decided_at" },
    },
  },
  {
    name: TOPICS_TABLE,
    options: {
      schema: TOPICS_SCHEMA,
      timePartitioning: { type: "DAY", field: "first_seen_at" },
    },
  },
  {
    name: EVENTS_TABLE,
    options: {
      schema: EVENTS_SCHEMA,
      timePartitioning: { type: "DAY", field: "occurred_at" },
    },
  },
  {
    name: TIME_BUCKETS_TABLE,
    options: {
      schema: TIME_BUCKETS_SCHEMA,
      timePartitioning: { type: "DAY", field: "start_date" },
      clustering: { fields: ["granularity"] },
    },
  },
  {
    name: ENGAGEMENT_DECISIONS_TABLE,
    options: {
      schema: ENGAGEMENT_DECISIONS_SCHEMA,
      timePartitioning: { type: "DAY", field: "decided_at" },
      clustering: { fields: ["platform", "action_type"] },
    },
  },
  {
    name: LEARNINGS_TABLE,
    options: {
      schema: LEARNINGS_SCHEMA,
      timePartitioning: { type: "DAY", field: "realized_at" },
      clustering: { fields: ["domain"] },
    },
  },
  {
    name: PERSONAL_EDGES_TABLE,
    options: {
      schema: PERSONAL_EDGES_SCHEMA,
      timePartitioning: { type: "DAY", field: "created_at" },
      clustering: { fields: ["edge_type", "src_kind", "src_id"] },
    },
  },
];

export interface PersonRow extends BaseRowFields {
  person_id: string;
  primary_handle: string | null;
  identifiers: Array<{ platform: string; value: string }> | null;
  display_name: string | null;
  bio: string | null;
}

export interface ContentRow extends BaseRowFields {
  content_id: string;
  source: ContentSource;
  external_id: string | null;
  url: string | null;
  title: string | null;
  body_md: string | null;
  body_summary: string | null;
  published_at: string | null;
  author_person_id: string | null;
}

export interface DecisionRow extends BaseRowFields {
  decision_id: string;
  title: string;
  rationale_md: string | null;
  decided_at: string;
  scope: Record<string, unknown> | null;
}

export interface TopicRow extends BaseRowFields {
  topic_id: string;
  name: string;
  description: string | null;
}

export interface EventRow extends BaseRowFields {
  event_id: string;
  title: string;
  description: string | null;
  occurred_at: string;
  location: string | null;
}

export interface TimeBucketRow extends BaseRowFields {
  bucket_id: string;
  granularity: TimeBucketGranularity;
  start_date: string; // YYYY-MM-DD
  end_date: string;
  label: string | null;
  parent_bucket_id: string | null;
  summary: string | null;
}

export interface LearningRow extends BaseRowFields {
  learning_id: string;
  insight: string;
  context: string | null;
  domain: string | null;
  applicability: string | null;
  realized_at: string;
}

export interface EngagementDecisionRow extends BaseRowFields {
  engagement_id: string;
  platform: string;
  account: string | null;
  action_type: EngagementActionType;
  posted_post_id: string | null;
  posted_post_type: string | null;
  target_post_id: string | null;
  target_user_id: string | null;
  target_handle: string | null;
  target_followers: number | null;
  our_text: string | null;
  voice_check: Record<string, unknown> | null;
  draft_iters: number | null;
  strategy_tier: string | null;
  rationale: string | null;
  decided_at: string;
  conversation_id: string | null;
}

export interface PersonalEdgeRow {
  edge_id: string;
  edge_type: PersonalEdgeType;
  src_kind: NodeTable;
  src_id: string;
  tgt_kind: NodeTable;
  tgt_id: string;
  weight: number | null;
  properties: Record<string, unknown> | null;
  created_at: string;
}
