#!/usr/bin/env tsx
/**
 * compact-log CLI entry。
 *
 * 使い方:
 *   pnpm log:compact                       # default: 30 日より前を archive
 *   pnpm log:compact --days=14             # 14 日窓
 *   pnpm log:compact --check               # 読み取りのみ、未 archive がある / log.md が cap 超 で exit 1
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business compact-log の filesystem 実行 entry。operations/log.md を読み、threshold 経過分を年月別 archive へ移送し、log.md を recent のみに圧縮する CLI。pre-commit / 手動 / cron いずれからも呼べる
 * @graph-connects none
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  bucketByYearMonth,
  buildArchiveContent,
  buildRecentContent,
  partitionByThreshold,
  splitSections,
} from "./compact-log.js";

/** @graph-connects none */
const DEFAULT_DAYS = 30;
/** @graph-connects none */
const LOG_PATH = "operations/log.md";

/**
 * @graph-connects none
 */
function archivePath(ym: string): string {
  return join("operations", `log.archive.${ym}.md`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      days: { type: "string", default: String(DEFAULT_DAYS) },
      check: { type: "boolean", default: false },
    },
    strict: true,
  });
  const days = parseInt(values.days as string, 10);
  if (isNaN(days) || days < 1) {
    throw new Error(`--days は正の整数: got ${values.days}`);
  }
  const checkOnly = Boolean(values.check);

  if (!existsSync(LOG_PATH)) {
    console.log(`${LOG_PATH} が存在しません。skip。`);
    return;
  }

  const md = readFileSync(LOG_PATH, "utf8");
  const { prologue, sections } = splitSections(md);
  const thresholdDate = new Date(Date.now() - days * 86400 * 1000);
  const { recent, archive } = partitionByThreshold(sections, thresholdDate);

  if (archive.length === 0) {
    console.log(
      `archive 対象なし (cutoff: ${thresholdDate.toISOString().slice(0, 10)}, sections: ${sections.length})`,
    );
    return;
  }

  if (checkOnly) {
    console.error(
      `❌ ${archive.length} sections older than ${days} days are still in ${LOG_PATH}. Run: pnpm log:compact`,
    );
    for (const s of archive) {
      console.error(`  - ${s.title}`);
    }
    process.exit(1);
  }

  const buckets = bucketByYearMonth(archive);
  for (const [ym, secs] of buckets) {
    const path = archivePath(ym);
    const existing = existsSync(path) ? readFileSync(path, "utf8") : null;
    const next = buildArchiveContent(existing, secs, ym);
    writeFileSync(path, next);
    console.log(`✓ archived ${secs.length} sections to ${path}`);
  }

  const newLog = buildRecentContent(prologue, recent);
  writeFileSync(LOG_PATH, newLog);
  console.log(
    `✓ ${LOG_PATH}: ${sections.length} → ${recent.length} sections (cutoff: ${thresholdDate.toISOString().slice(0, 10)})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
