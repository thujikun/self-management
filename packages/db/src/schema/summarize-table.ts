/**
 * Drizzle `getTableConfig` の結果を snapshot 可能な plain object に要約する helper。
 *
 * 各 schema file の sibling test (`posts.test.ts` / `comments.test.ts` 等) が同じ
 * 観点 (table 名 / 列 / PK / FK / index / unique 制約) で shape を凍結できるよう、
 * 要約ロジックをここに集約する。index / unique 制約も含めるのは、冪等 upsert
 * (`comments_source_id_uq`) のように index が実行時の前提になるケースを snapshot
 * から漏らさないため。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business Drizzle schema shape (name / columns / PK / FK / index / unique) の snapshot 用要約。schema sibling test 群が同一観点で drift 検知できるよう要約ロジックを 1 箇所に集約する
 * @graph-connects none
 */

import { getTableConfig } from "drizzle-orm/pg-core";

/** @graph-connects none */
export type TableConfig = ReturnType<typeof getTableConfig>;

/**
 * table 定義の shape を snapshot 向けに要約する。列は名前順に整列し、FK は参照先
 * table 名 / 列 / onDelete を、index は名前 / unique / 対象列を含める。
 *
 * @graph-connects none
 */
export function summarizeTable(table: TableConfig) {
  return {
    name: table.name,
    columns: table.columns
      .map((c) => ({
        name: c.name,
        notNull: c.notNull,
        primary: c.primary,
        hasDefault: c.hasDefault,
        isUnique: c.isUnique,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    primaryKeys: table.primaryKeys.map((pk) => pk.columns.map((c) => c.name).sort()),
    foreignKeys: table.foreignKeys.map((fk) => {
      const ref = fk.reference();
      return {
        columns: ref.columns.map((c) => c.name),
        foreignTable: getTableConfig(ref.foreignTable).name,
        foreignColumns: ref.foreignColumns.map((c) => c.name),
        // drizzle は未指定の FK action を "no action" に defaults するので undefined は来ない
        onDelete: fk.onDelete,
      };
    }),
    indexes: table.indexes.map((i) => ({
      name: i.config.name,
      unique: i.config.unique,
      // index 対象は通常の列 (name を持つ) か SQL 式。式は snapshot 上 "<sql>" と表す。
      columns: i.config.columns.map((c) => ("name" in c ? c.name : "<sql>")),
    })),
    uniqueConstraints: table.uniqueConstraints.map((u) => ({
      name: u.name,
      columns: u.columns.map((c) => c.name),
    })),
  };
}
