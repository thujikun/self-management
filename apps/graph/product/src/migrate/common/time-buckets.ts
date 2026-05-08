/**
 * 時間軸 anchor (day / week / month) の bucket_id 計算と node/edge 構築 helper。
 *
 * biz-graph の initiative ノードと同思想で、全 activity を day node に anchor し
 * day → week → month を `rolls_up_to` edge で繋ぐ。これにより
 * 「今週の activity」「今月の振り返り」が graph traverse 1 query で取れる。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business 時間軸 anchor の ID 計算と lazy upsert 用 NodeInput / EdgeInput を生成。day / week / month の 3 階層を ISO 8601 規則で正規化し、CLI 経由の単発 insert でも一貫した bucket_id を保つ
 * @graph-connects bigquery [writes_to] time_buckets テーブルへの NodeInput と personal_edges (rolls_up_to) の EdgeInput を組み立てる
 */

import type { NodeTable } from "../../schema/index.js";
import type { EdgeInput, NodeInput } from "./types.js";

/**
 * 1 つの timestamp に対応する 3 階層の bucket_id。
 *
 * @graph-connects none
 */
export interface BucketIds {
  day: string;
  week: string;
  month: string;
}

/**
 * 日付から day:YYYY-MM-DD 形式の bucket_id を作る。timezone は UTC 扱い。
 *
 * @graph-connects none
 */
export function dayBucketId(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `day:${y}-${m}-${d}`;
}

/**
 * 月から month:YYYY-MM 形式の bucket_id を作る。
 *
 * @graph-connects none
 */
export function monthBucketId(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `month:${y}-${m}`;
}

/**
 * ISO 8601 週番号を計算 (月曜始まり、週 1 = その年最初の木曜を含む週)。
 *
 * @graph-connects none
 */
export function isoWeek(date: Date): { year: number; week: number } {
  // ISO 週は木曜基準で計算
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7; // Sunday=0 を 7 に変換
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // 同週の木曜に合わせる
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week: weekNum };
}

/**
 * 日付から week:YYYY-Www 形式の bucket_id を作る。
 *
 * @graph-connects none
 */
export function weekBucketId(date: Date): string {
  const { year, week } = isoWeek(date);
  return `week:${year}-W${String(week).padStart(2, "0")}`;
}

/**
 * 全階層の bucket_id を一括計算。
 *
 * @graph-connects none
 */
export function computeBucketIds(date: Date): BucketIds {
  return {
    day: dayBucketId(date),
    week: weekBucketId(date),
    month: monthBucketId(date),
  };
}

/**
 * ISO 週の月曜日 (= week 開始日) を返す。
 *
 * @graph-connects none
 */
export function isoWeekStart(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (dayNum - 1));
  return d;
}

/**
 * YYYY-MM-DD 形式に整形。
 *
 * @graph-connects none
 */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * 曜日の英語名 (Mon/Tue/.../Sun)。
 *
 * @graph-connects none
 */
export function weekdayName(date: Date): string {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return names[date.getUTCDay()];
}

/**
 * 指定日の day / week / month NodeInput と rolls_up_to edge を一括生成。
 * CLI 経由 lazy upsert 用、idempotent (deterministicId 経由で同じ bucket は MERGE で吸収)。
 *
 * @graph-connects bigquery [writes_to] time_buckets ノード 3 行と rolls_up_to エッジ 2 本を返す
 */
export function buildBucketNodes(date: Date): { nodes: NodeInput[]; edges: EdgeInput[] } {
  const ids = computeBucketIds(date);
  const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekStart = isoWeekStart(date);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  const monthStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));

  const dayNode: NodeInput = {
    kind: "time_buckets",
    id: ids.day,
    fields: {
      bucket_id: ids.day,
      granularity: "day",
      start_date: isoDate(dayStart),
      end_date: isoDate(dayStart),
      label: `${isoDate(dayStart)} (${weekdayName(dayStart)})`,
      parent_bucket_id: ids.week,
    },
  };

  const { year: weekYear, week: weekNum } = isoWeek(date);
  const weekNode: NodeInput = {
    kind: "time_buckets",
    id: ids.week,
    fields: {
      bucket_id: ids.week,
      granularity: "week",
      start_date: isoDate(weekStart),
      end_date: isoDate(weekEnd),
      label: `Week ${weekNum} / ${weekYear} (${isoDate(weekStart)} 〜 ${isoDate(weekEnd)})`,
      parent_bucket_id: ids.month,
    },
  };

  const monthName = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ][date.getUTCMonth()];
  const monthNode: NodeInput = {
    kind: "time_buckets",
    id: ids.month,
    fields: {
      bucket_id: ids.month,
      granularity: "month",
      start_date: isoDate(monthStart),
      end_date: isoDate(monthEnd),
      label: `${monthName} ${date.getUTCFullYear()}`,
      parent_bucket_id: null,
    },
  };

  const edges: EdgeInput[] = [
    {
      edge_table: "personal_edges",
      edge_type: "rolls_up_to",
      src_kind: "time_buckets",
      src_id: ids.day,
      tgt_kind: "time_buckets",
      tgt_id: ids.week,
    },
    {
      edge_table: "personal_edges",
      edge_type: "rolls_up_to",
      src_kind: "time_buckets",
      src_id: ids.week,
      tgt_kind: "time_buckets",
      tgt_id: ids.month,
    },
  ];

  return { nodes: [dayNode, weekNode, monthNode], edges };
}

/**
 * 任意の activity ノード (decision / learning / engagement_decision 等) に対して
 * day/week/month bucket cascade と occurred_on edge (activity → day) を一括生成する helper。
 * 各 CLI が time anchoring を一貫して emit するための薄い wrapper。
 *
 * @graph-connects bigquery [writes_to] time_buckets ノード 3 行 + occurred_on / rolls_up_to edges
 */
export function buildActivityAnchor(
  srcKind: NodeTable,
  srcId: string,
  date: Date,
): { nodes: NodeInput[]; edges: EdgeInput[] } {
  const buckets = buildBucketNodes(date);
  const dayId = buckets.nodes[0].id;
  const occurredOn: EdgeInput = {
    edge_table: "personal_edges",
    edge_type: "occurred_on",
    src_kind: srcKind,
    src_id: srcId,
    tgt_kind: "time_buckets",
    tgt_id: dayId,
    created_at: date.toISOString(),
  };
  return { nodes: buckets.nodes, edges: [occurredOn, ...buckets.edges] };
}
